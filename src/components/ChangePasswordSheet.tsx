// Password change for email + password accounts.
//   mode 'change' — from Account: asks for the current password first.
//   mode 'forced' — first sign-in on an account the admin created with a
//                   temporary password (user_metadata.must_change_password);
//                   can't be dismissed until a new password is set.
import { useState } from 'react'
import { View, Text, TextInput, Pressable, Modal, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X, Eye, EyeOff, CheckCircle2 } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'

const MIN_LENGTH = 8

export default function ChangePasswordSheet({
  visible,
  mode,
  email,
  onClose,
}: {
  visible: boolean
  mode: 'change' | 'forced'
  email: string | null
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function reset() {
    setCurrent(''); setNext(''); setConfirm(''); setError(''); setDone(false); setShow(false)
  }

  function close() {
    if (mode === 'forced' && !done) return
    reset()
    onClose()
  }

  async function save() {
    setError('')
    if (mode === 'change' && !current) return setError('Enter your current password.')
    if (next.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`)
    if (next !== confirm) return setError("The two passwords don't match.")
    if (mode === 'change' && next === current) return setError('Choose a password different from your current one.')

    setBusy(true)
    try {
      if (mode === 'change') {
        // Re-check the current password: a phone left unlocked shouldn't be
        // enough to take over the account.
        if (!email) throw new Error('No email on this account.')
        const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current })
        if (authErr) throw new Error('Your current password is incorrect.')
      }
      const { error: updErr } = await supabase.auth.updateUser({
        password: next,
        data: { must_change_password: false },
      })
      if (updErr) throw updErr
      setDone(true)
    } catch (e: any) {
      setError(e?.message ?? 'Could not change the password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const field = (value: string, set: (v: string) => void, placeholder: string) => (
    <View style={st.inputWrap}>
      <TextInput
        style={st.input}
        value={value}
        onChangeText={(t) => { set(t); setError('') }}
        placeholder={placeholder}
        placeholderTextColor={Colors.textLight}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
      />
    </View>
  )

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={st.overlay} onPress={close}>
          <Pressable style={[st.sheet, { paddingBottom: 24 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            <View style={st.header}>
              <Text style={st.title}>{mode === 'forced' ? 'Set your password' : 'Change password'}</Text>
              {(mode === 'change' || done) && (
                <Pressable onPress={close} hitSlop={10}><X size={20} color={Colors.textMuted} /></Pressable>
              )}
            </View>

            {done ? (
              <View style={st.doneWrap}>
                <CheckCircle2 size={40} color={Colors.primary} />
                <Text style={st.doneText}>Password updated.</Text>
                <Pressable style={st.primaryBtn} onPress={close}>
                  <Text style={st.primaryBtnText}>Done</Text>
                </Pressable>
              </View>
            ) : (
              <>
                {mode === 'forced' && (
                  <Text style={st.lead}>
                    You signed in with a temporary password from GreenFeast. Choose your own to continue.
                  </Text>
                )}
                {mode === 'change' && field(current, setCurrent, 'Current password')}
                {field(next, setNext, `New password (min ${MIN_LENGTH} characters)`)}
                {field(confirm, setConfirm, 'Confirm new password')}
                <Pressable onPress={() => setShow((s) => !s)} style={st.showRow} hitSlop={8}>
                  {show ? <EyeOff size={16} color={Colors.textMuted} /> : <Eye size={16} color={Colors.textMuted} />}
                  <Text style={st.showText}>{show ? 'Hide passwords' : 'Show passwords'}</Text>
                </Pressable>
                {!!error && <Text style={st.error}>{error}</Text>}
                <Pressable style={[st.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryBtnText}>Save password</Text>}
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
  lead: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 14 },
  inputWrap: { borderWidth: 1, borderColor: Colors.borderFaint, borderRadius: 12, marginBottom: 10 },
  input: { fontFamily: Fonts.body, fontSize: 15, color: Colors.text, paddingHorizontal: 14, paddingVertical: 13 },
  showRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, alignSelf: 'flex-start' },
  showText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 4 },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  doneWrap: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  doneText: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.text },
})
