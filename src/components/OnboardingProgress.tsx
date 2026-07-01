import { View, StyleSheet } from 'react-native'
import { Colors } from '@/constants/colors'

interface Props {
  steps: number
  current: number  // 0-indexed
}

export default function OnboardingProgress({ steps, current }: Props) {
  return (
    <View style={styles.row}>
      {Array.from({ length: steps }, (_, i) => (
        <View key={i} style={styles.segment}>
          {i > 0 && (
            <View style={[styles.line, i <= current && styles.lineActive]} />
          )}
          <View style={[
            styles.node,
            i < current ? styles.nodeDone :
            i === current ? styles.nodeCurrent :
            styles.nodeFuture,
          ]} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  line: {
    flex: 1,
    height: 1.5,
    backgroundColor: Colors.border,
    marginHorizontal: 5,
  },
  lineActive: {
    backgroundColor: Colors.green700,
  },
  node: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  nodeDone: {
    backgroundColor: Colors.green700,
    borderColor: Colors.green700,
  },
  nodeCurrent: {
    backgroundColor: 'transparent',
    borderColor: Colors.green700,
  },
  nodeFuture: {
    backgroundColor: 'transparent',
    borderColor: Colors.border,
  },
})
