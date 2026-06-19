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
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import { SHOW_DEV_SKIP } from '@/constants/dev'
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
  const { user, signOut } = useAuthStore()

  async function handleLogout() {
    setLogoutConfirm(false)
    await signOut()
    // AuthGate also redirects on session=null; this is an explicit fallback so
    // logout can never appear to do nothing.
    router.replace('/(auth)/phone')
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
    if (!user) { setLoading(false); return }
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [user])

  const initial = (name || 'G').charAt(0).toUpperCase()

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
          <RefreshCw size={14} color={Colors.primary} />
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
        <Text style={styles.title}>Account</Text>

        {/* Profile card */}
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
            onPress={() => setFaqExpanded((v) => !v)}
          >
            <HelpCircle size={18} color={Colors.primary} />
            <Text style={[styles.rowLabel, { flex: 1 }]}>FAQ</Text>
            {faqExpanded ? <ChevronUp size={16} color={Colors.textLight} /> : <ChevronDown size={16} color={Colors.textLight} />}
          </Pressable>

          {faqExpanded && (
            <View style={styles.faqList}>
              {FAQS.map((faq, i) => (
                <View key={i} style={i < FAQS.length - 1 && styles.faqItemBorder}>
                  <Pressable style={styles.faqQuestion} onPress={() => setOpenFaq(openFaq === i ? null : i)}>
                    <Text style={styles.faqQ}>{faq.q}</Text>
                    {openFaq === i ? <ChevronUp size={14} color={Colors.textLight} /> : <ChevronDown size={14} color={Colors.textLight} />}
                  </Pressable>
                  {openFaq === i && <Text style={styles.faqA}>{faq.a}</Text>}
                </View>
              ))}
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => setLogoutConfirm(true)}
          >
            <LogOut size={18} color={Colors.textMuted} />
            <Text style={[styles.rowLabel, { color: Colors.textMuted }]}>Logout</Text>
          </Pressable>

          {SHOW_DEV_SKIP && (
            <Pressable
              style={({ pressed }) => [styles.row, styles.rowDanger, pressed && styles.rowPressed]}
              onPress={() => setResetConfirm(true)}
            >
              <RefreshCw size={18} color={Colors.danger} />
              <Text style={[styles.rowLabel, { color: Colors.danger }]}>Dev: Reset all data</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.version}>GreenFeast v1.0</Text>
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
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 20 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 18, color: '#fff' },
  profileName: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.text },
  profilePhone: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, marginTop: 2 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 56 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  rowPressed: { backgroundColor: Colors.hover },
  rowDanger: { borderTopWidth: 1, borderTopColor: Colors.borderFaint },
  rowLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text },

  faqList: { paddingHorizontal: 16, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  faqItemBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  faqQuestion: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, paddingVertical: 12 },
  faqQ: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.text, flex: 1 },
  faqA: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, lineHeight: 18, paddingBottom: 12 },

  version: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textLight, textAlign: 'center', marginTop: 8 },

  // Error state
  errorWrap: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorEmoji: { fontSize: 40, marginBottom: 12 },
  errorTitle: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.text, textAlign: 'center', marginBottom: 6 },
  errorDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginBottom: 20 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  retryText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 320 },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text, marginBottom: 8 },
  modalDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, marginBottom: 12 },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  modalBtnGhost: { backgroundColor: Colors.primaryLight },
  modalBtnGhostText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },
  modalBtnPrimary: { backgroundColor: Colors.primary },
  modalBtnPrimaryText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },
  modalBtnDanger: { backgroundColor: '#ef4444' },
  modalBtnDangerText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },
  resetError: { fontFamily: Fonts.body, fontSize: 12, color: '#ef4444', marginBottom: 12, textAlign: 'center' },
})
