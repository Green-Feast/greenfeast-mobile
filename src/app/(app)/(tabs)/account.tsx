import { useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Modal,
  Linking,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import {
  MessageCircle,
  HelpCircle,
  LogOut,
  LogIn,
  FileText,
  Shield,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  RefreshCw,
} from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { useUpdates } from 'expo-updates'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import { SHOW_DEV_SKIP } from '@/constants/dev'
import { APP_VERSION_STRING } from '@/constants/version'
import Skeleton from '@/components/Skeleton'

const FAQS = [
  { q: 'Can I change my meals after subscribing?', a: 'Yes! You can swap meals up to 8 PM the night before delivery.' },
  { q: 'What if I need to skip a day?', a: 'Use "Skip a day" in My Plan anytime before 8 PM the night before.' },
  { q: 'Are your meals really preservative-free?', a: "Absolutely. Every meal is freshly prepared the same morning it's delivered." },
  { q: 'Can I pause my subscription?', a: 'Yes, you can pause for up to 2 weeks per cycle from the My Plan tab.' },
  { q: 'Can I change my delivery time slot?', a: "Yes! Just message us on WhatsApp and we'll update your slot right away." },
]

export default function AccountScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, signOut, loading: authLoading } = useAuthStore()
  const { currentlyRunning } = useUpdates()

  async function handleLogout() {
    setLogoutConfirm(false)
    await signOut()
    // AuthGate also redirects on session=null; this is an explicit fallback so
    // logout can never appear to do nothing.
    router.replace('/(auth)/login' as any)
  }

  async function handleDevReset() {
    setResetConfirm(false)
    setResetting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      // Call edge function to delete all user data
      const { error } = await supabase.functions.invoke('delete-user-data', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (error) throw error

      // Clear local state and redirect to onboarding
      await signOut()
      router.replace('/(onboarding)/health')
    } catch (e) {
      setResetError((e as any)?.message ?? 'Reset failed')
      setResetting(false)
    }
  }

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [faqExpanded, setFaqExpanded] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  async function fetchData() {
    if (!user) return
    setError(false)
    try {
      const userRes = await supabase.from('users').select('name, phone').eq('id', user.id).maybeSingle()
      if (userRes.error && !userRes.data) throw userRes.error
      const metaName = (user.user_metadata?.full_name as string) ?? (user.user_metadata?.name as string) ?? ''
      setName(userRes.data?.name || metaName || '')
      setPhone(userRes.data?.phone || user.email || '')
    } catch {
      setError(true)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!user) { setLoading(false); return }
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [user, authLoading])

  const initial = (name || 'G').charAt(0).toUpperCase()

  function toggleFaqSection() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setFaqExpanded((v) => !v)
  }

  function toggleFaqItem(i: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setOpenFaq(openFaq === i ? null : i)
  }

  // ── Skeleton loading ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}
          showsVerticalScrollIndicator={false}
        >
          <Skeleton width={80} height={26} style={{ marginBottom: 20 }} />

          {/* Profile card skeleton */}
          <View style={styles.card}>
            <View style={styles.profileRow}>
              <Skeleton width={48} height={48} borderRadius={24} />
              <View style={{ gap: 8, flex: 1 }}>
                <Skeleton width="55%" height={16} />
                <Skeleton width="40%" height={14} />
              </View>
            </View>
          </View>

          {/* List card skeleton */}
          <View style={styles.card}>
            {[56, 56, 56].map((h, i) => (
              <View key={i} style={[{ padding: 16 }, i < 2 && styles.rowBorder]}>
                <Skeleton height={20} width="50%" />
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (error) {
    return (
      <View style={[styles.container, styles.errorWrap]}>
        <Text style={styles.errorEmoji}>⚠️</Text>
        <Text style={styles.errorTitle}>Couldn't load your account</Text>
        <Text style={styles.errorDesc}>Check your connection and try again.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => { setLoading(true); fetchData().finally(() => setLoading(false)) }}
        >
          <RefreshCw size={14} color={Colors.green700} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Screen ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>ACCOUNT</Text>

        {/* Profile card — G4 (guest) vs LG4/S4 (signed in) */}
        {user ? (
          <View style={styles.card}>
            <View style={styles.profileRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              <View>
                <Text style={styles.profileName}>{name || '—'}</Text>
                <Text style={styles.profilePhone}>{phone || '—'}</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.guestTitle}>You're browsing as a guest</Text>
            <Text style={styles.guestDesc}>Sign in to build a plan, track orders, and save your details.</Text>
            <Pressable
              style={({ pressed }) => [styles.guestCta, pressed && { opacity: 0.85 }]}
              onPress={() => router.push('/(auth)/login' as any)}
            >
              <LogIn size={16} color="#fff" />
              <Text style={styles.guestCtaText}>Login / Sign up</Text>
            </Pressable>
          </View>
        )}

        {/* Support + FAQ */}
        <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
          <Pressable
            style={({ pressed }) => [styles.row, styles.rowBorder, pressed && styles.rowPressed]}
            onPress={() => Linking.openURL('https://wa.me/918829040566')}
          >
            <MessageCircle size={18} color={Colors.whatsapp} />
            <Text style={styles.rowLabel}>WhatsApp Support</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.row, faqExpanded && styles.rowBorder, pressed && styles.rowPressed]}
            onPress={toggleFaqSection}
          >
            <HelpCircle size={18} color={Colors.green700} />
            <Text style={[styles.rowLabel, { flex: 1 }]}>FAQ</Text>
            {faqExpanded ? <ChevronUp size={16} color={Colors.ink400} /> : <ChevronDown size={16} color={Colors.ink400} />}
          </Pressable>

          {faqExpanded && (
            <View style={styles.faqList}>
              {FAQS.map((faq, i) => (
                <View key={i} style={i < FAQS.length - 1 && styles.faqItemBorder}>
                  <Pressable style={styles.faqQuestion} onPress={() => toggleFaqItem(i)}>
                    <Text style={styles.faqQ}>{faq.q}</Text>
                    {openFaq === i ? <ChevronUp size={14} color={Colors.ink400} /> : <ChevronDown size={14} color={Colors.ink400} />}
                  </Pressable>
                  {openFaq === i && <Text style={styles.faqA}>{faq.a}</Text>}
                </View>
              ))}
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.row, styles.rowBorder, pressed && styles.rowPressed]}
            onPress={() => router.push('/legal/terms' as any)}
          >
            <FileText size={18} color={Colors.ink500} />
            <Text style={[styles.rowLabel, { flex: 1 }]}>Terms & Conditions</Text>
            <ChevronRight size={16} color={Colors.ink400} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.row, user && styles.rowBorder, pressed && styles.rowPressed]}
            onPress={() => router.push('/legal/privacy' as any)}
          >
            <Shield size={18} color={Colors.ink500} />
            <Text style={[styles.rowLabel, { flex: 1 }]}>Privacy Policy</Text>
            <ChevronRight size={16} color={Colors.ink400} />
          </Pressable>

          {user && (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => setLogoutConfirm(true)}
            >
              <LogOut size={18} color={Colors.danger} />
              <Text style={[styles.rowLabel, { color: Colors.danger }]}>Logout</Text>
            </Pressable>
          )}

          {user && SHOW_DEV_SKIP && (
            <Pressable
              style={({ pressed }) => [styles.row, styles.rowDanger, pressed && styles.rowPressed]}
              onPress={() => setResetConfirm(true)}
            >
              <RefreshCw size={18} color={Colors.danger} />
              <Text style={[styles.rowLabel, { color: Colors.danger }]}>Dev: Reset all data</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.version}>GreenFeast v{APP_VERSION_STRING}</Text>

        {SHOW_DEV_SKIP && (
          <View style={styles.diag}>
            <Text style={styles.diagText}>
              channel: {currentlyRunning.channel ?? '(none — cannot OTA)'}
            </Text>
            <Text style={styles.diagText}>
              source: {currentlyRunning.isEmbeddedLaunch ? 'embedded build' : 'OTA update'}
            </Text>
            <Text style={styles.diagText}>
              updateId: {currentlyRunning.updateId ?? '(embedded)'}
            </Text>
            <Text style={styles.diagText}>
              runtime: {currentlyRunning.runtimeVersion ?? '—'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Logout confirm */}
      <Modal visible={logoutConfirm} transparent animationType="fade" onRequestClose={() => setLogoutConfirm(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Log out?</Text>
            <Text style={styles.modalDesc}>Your subscription data will be saved.</Text>
            <View style={styles.modalButtons}>
              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setLogoutConfirm(false)}>
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={handleLogout}>
                <Text style={styles.modalBtnPrimaryText}>Log out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Dev reset confirm */}
      <Modal visible={resetConfirm} transparent animationType="fade" onRequestClose={() => !resetting && setResetConfirm(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🧹 Reset all data?</Text>
            <Text style={styles.modalDesc}>This will delete your subscriptions, orders, profile, and dietary info. You'll start the onboarding fresh.</Text>
            {resetError && <Text style={styles.resetError}>{resetError}</Text>}
            <View style={styles.modalButtons}>
              <Pressable style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setResetConfirm(false)} disabled={resetting}>
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnDanger]} onPress={handleDevReset} disabled={resetting}>
                {resetting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBtnDangerText}>Reset</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  eyebrow: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 12,
  },

  card: {
    backgroundColor: Colors.cream100,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.ink100,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.green700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: '#fff' },
  profileName: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.ink900 },
  profilePhone: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, marginTop: 2 },

  guestTitle: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.ink900, marginBottom: 4 },
  guestDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, lineHeight: 18, marginBottom: 16 },
  guestCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.green700, borderRadius: 999, paddingVertical: 13, minHeight: 48,
  },
  guestCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 56 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.ink100 },
  rowPressed: { backgroundColor: Colors.cream200 },
  rowDanger: { borderTopWidth: 1, borderTopColor: Colors.ink100 },
  rowLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink900 },

  faqList: { paddingHorizontal: 16, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: Colors.ink100 },
  faqItemBorder: { borderBottomWidth: 1, borderBottomColor: Colors.ink100 },
  faqQuestion: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, paddingVertical: 12 },
  faqQ: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.ink900, flex: 1 },
  faqA: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink500, lineHeight: 18, paddingBottom: 12 },

  version: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink400, textAlign: 'center', marginTop: 8 },
  diag: { marginTop: 12, paddingHorizontal: 16, gap: 2 },
  diagText: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink400, textAlign: 'center' },

  // Error state
  errorWrap: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorEmoji: { fontSize: 40, marginBottom: 12 },
  errorTitle: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.ink900, textAlign: 'center', marginBottom: 6 },
  errorDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, textAlign: 'center', marginBottom: 20 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.green700,
  },
  retryText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.green700 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: Colors.cream50, borderRadius: 24, padding: 24, width: '100%', maxWidth: 320 },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.ink900, marginBottom: 8 },
  modalDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, marginBottom: 12 },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  modalBtnGhost: { backgroundColor: Colors.green50 },
  modalBtnGhostText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.green700 },
  modalBtnPrimary: { backgroundColor: Colors.green700 },
  modalBtnPrimaryText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },
  modalBtnDanger: { backgroundColor: Colors.danger },
  modalBtnDangerText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },
  resetError: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginBottom: 12, textAlign: 'center' },
})
