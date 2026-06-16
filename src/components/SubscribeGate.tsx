import { View, Text, Pressable, StyleSheet, DimensionValue } from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { ArrowRight } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'

interface SubscribeGateProps {
  onSubscribe: () => void
  onExplore: () => void
}

const SKEL_ROW_WIDTHS: DimensionValue[] = ['62%', '54%', '48%', '40%']

/**
 * Full-bleed "locked" overlay shown to non-subscribers.
 *
 * The user must not be able to read the plans/prices behind it, so the backdrop
 * is a *text-free skeleton* (coloured blocks only) — that guarantees nothing is
 * legible regardless of how strong the native blur happens to be. On top of that
 * we stack: a heavy BlurView, a cream scrim, then a frosted-glass modal card.
 */
export default function SubscribeGate({ onSubscribe, onExplore }: SubscribeGateProps) {
  return (
    <View style={styles.root}>
      {/* 1. Skeleton dashboard — suggests "a screen is here" with zero readable text */}
      <View style={styles.skeleton} pointerEvents="none">
        <View style={styles.skelPlanCard}>
          <View style={styles.skelPlanHeader}>
            <View style={[styles.bar, { width: '55%', backgroundColor: 'rgba(255,255,255,0.5)' }]} />
            <View style={styles.skelBadge} />
          </View>
          <View style={[styles.bar, { width: '72%', backgroundColor: 'rgba(255,255,255,0.32)', marginTop: 12 }]} />
          <View style={styles.skelPlanBody}>
            <View style={[styles.bar, { width: '45%' }]} />
            <View style={[styles.track]}>
              <View style={styles.trackFill} />
            </View>
          </View>
        </View>

        <View style={styles.skelCard}>
          {SKEL_ROW_WIDTHS.map((w, i) => (
            <View key={i} style={styles.skelRow}>
              <View style={styles.skelDot} />
              <View style={[styles.bar, { width: w }]} />
            </View>
          ))}
        </View>
      </View>

      {/* 2. Heavy frosted backdrop + 3. cream scrim */}
      <BlurView intensity={95} tint="light" style={StyleSheet.absoluteFill} />
      <View style={styles.scrim} />

      {/* 4. Frosted-glass modal card */}
      <View style={styles.center}>
        <View style={styles.cardShadow}>
          <BlurView intensity={50} tint="light" style={styles.card}>
            {/* semi-transparent white fill lets the blur bleed through */}
            <View style={styles.cardTint} />
            {/* top highlight — the subtle sheen that sells Apple-style glass */}
            <LinearGradient
              colors={['rgba(255,255,255,0.6)', 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 0.55 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />

            <View style={styles.content}>
              <View style={styles.leafCircle}>
                <Text style={styles.leaf}>🌿</Text>
              </View>
              <Text style={styles.title}>Start your plan</Text>
              <Text style={styles.desc}>
                Subscribe to unlock daily fresh meals, your weekly schedule, wallet, and more.
              </Text>

              <Pressable
                style={({ pressed }) => [styles.cta, pressed && { backgroundColor: Colors.primaryDark }]}
                onPress={onSubscribe}
              >
                <Text style={styles.ctaText}>Subscribe now</Text>
                <ArrowRight size={15} color="#fff" strokeWidth={2.5} />
              </Pressable>

              <Pressable style={styles.secondary} onPress={onExplore} hitSlop={8}>
                <Text style={styles.secondaryText}>Explore menu first</Text>
              </Pressable>
            </View>
          </BlurView>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative' },

  // Skeleton backdrop
  skeleton: { paddingHorizontal: 16, paddingTop: 4, gap: 16 },
  skelPlanCard: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  skelPlanHeader: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skelBadge: { width: 56, height: 22, borderRadius: 999, backgroundColor: Colors.accent, opacity: 0.85 },
  skelPlanBody: { padding: 16, gap: 14 },
  skelCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 16 },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skelDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.border },
  bar: { height: 12, borderRadius: 6, backgroundColor: Colors.border },
  track: { height: 10, borderRadius: 999, backgroundColor: Colors.border, overflow: 'hidden' },
  trackFill: { height: '100%', width: '65%', borderRadius: 999, backgroundColor: Colors.primaryMid },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(253, 249, 232, 0.5)' },

  // Modal card
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  cardShadow: {
    width: '100%',
    maxWidth: 330,
    borderRadius: 30,
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 16,
  },
  card: {
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  cardTint: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255,255,255,0.72)' },
  content: { padding: 32, alignItems: 'center' },

  leafCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  leaf: { fontSize: 30 },
  title: { fontFamily: Fonts.heading, fontSize: 21, color: Colors.text, textAlign: 'center', marginBottom: 8 },
  desc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, width: '100%', paddingVertical: 15,
    borderRadius: 999, minHeight: 50,
  },
  ctaText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  secondary: { marginTop: 12, paddingVertical: 8 },
  secondaryText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
})
