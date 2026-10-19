// Account → Send feedback: an idea, a problem, a compliment or anything else.
// Goes to admin → Feedback (App feedback) and alerts the team.
import { useState } from 'react'
import { View, Text, TextInput, Pressable, Modal, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { X, CheckCircle2, Lightbulb, CircleAlert, Heart, MessageCircle } from 'lucide-react-native'
import { sendFeedback, type FeedbackKind } from '@/lib/ratings'
import { supportWhatsAppUrl } from '@/constants/links'
import { Colors, Fonts } from '@/constants/colors'

const KINDS: { key: FeedbackKind; label: string; Icon: typeof Lightbulb }[] = [
  { key: 'idea', label: 'Idea', Icon: Lightbulb },
  { key: 'problem', label: 'Problem', Icon: CircleAlert },
  { key: 'praise', label: 'Compliment', Icon: Heart },
  { key: 'other', label: 'Other', Icon: MessageCircle },
]

const PLACEHOLDER: Record<FeedbackKind, string> = {
  idea: 'What would make GreenFeast better for you?',
  problem: 'What went wrong? Where in the app, and what did you expect?',
  praise: 'What do you like? We pass it on to the team.',
  other: 'Tell us anything.',
}

export default function FeedbackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [kind, setKind] = useState<FeedbackKind>('idea')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function close() {
    if (busy) return
    setKind('idea'); setMessage(''); setError(''); setDone(false)
    onClose()
  }

  async function send() {
    if (!message.trim()) return setError('Please write a message.')
    setBusy(true)
    setError('')
    try {
      await sendFeedback(kind, message)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      setDone(true)
    } catch (e: any) {
      setError(e?.message ?? 'Could not send your feedback. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={st.overlay} onPress={close}>
          <Pressable style={[st.sheet, { paddingBottom: 24 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            <View style={st.header}>
              <Text style={st.title}>{done ? 'Thank you!' : 'Send feedback'}</Text>
              <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close"><X size={20} color={Colors.textMuted} /></Pressable>
            </View>

            {done ? (
              <View style={st.doneWrap}>
                <CheckCircle2 size={40} color={Colors.primary} />
                <Text style={st.doneText}>Our team reads every message. For anything urgent about today's meal, WhatsApp us.</Text>
                <Pressable style={[st.primaryBtn, { alignSelf: 'stretch' }]} onPress={close}>
                  <Text style={st.primaryBtnText}>Done</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={st.kinds}>
                  {KINDS.map(({ key, label, Icon }) => {
                    const on = kind === key
                    return (
                      <Pressable
                        key={key}
                        onPress={() => { Haptics.selectionAsync().catch(() => {}); setKind(key) }}
                        style={[st.kind, on && st.kindOn]}
                        accessibilityState={{ selected: on }}
                      >
                        <Icon size={16} color={on ? Colors.primary : Colors.ink500} />
                        <Text style={[st.kindText, on && st.kindTextOn]}>{label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
                <TextInput
                  style={st.input}
                  value={message}
                  onChangeText={(t) => { setMessage(t); setError('') }}
                  placeholder={PLACEHOLDER[kind]}
                  placeholderTextColor={Colors.textLight}
                  multiline
                  maxLength={2000}
                  textAlignVertical="top"
                />
                {!!error && <Text style={st.error}>{error}</Text>}
                <Pressable style={[st.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={send}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryBtnText}>Send</Text>}
                </Pressable>
                <Pressable onPress={() => Linking.openURL(supportWhatsAppUrl('Account > Send feedback'))} hitSlop={6} style={st.waRow}>
                  <Text style={st.waText}>Need help right now? Chat with us on WhatsApp</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontFamily: Fonts.headingSemi, fontSize: 20, color: Colors.text },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  kind: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#fff',
  },
  kindOn: { backgroundColor: Colors.green50, borderColor: Colors.primary },
  kindText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.text },
  kindTextOn: { color: Colors.primary },
  input: {
    fontFamily: Fonts.body, fontSize: 15, color: Colors.text, minHeight: 120, maxHeight: 220,
    borderWidth: 1, borderColor: Colors.borderFaint, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
  },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 8 },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  waRow: { alignSelf: 'center', marginTop: 14 },
  waText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.primary },
  doneWrap: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  doneText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
})
