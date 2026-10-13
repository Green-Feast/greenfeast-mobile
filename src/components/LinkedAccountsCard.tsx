// Account → Sign-in methods: link Google and/or Apple to the current account,
// so a customer can sign in with any of them. Matters most for accounts the
// admin created with email + password: Google with the same Gmail links by
// itself, but Apple's "Hide My Email" relay address never matches, so it has
// to be linked from inside the signed-in account. Needs "Allow manual
// linking" on in Supabase (Authentication → Sign In / Providers).
import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { makeRedirectUri } from 'expo-auth-session'
import { Check, Link2 } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'

type Provider = 'google' | 'apple'

function friendly(message: string | undefined) {
  const m = message ?? ''
  if (/manual linking/i.test(m)) return 'Linking isn’t switched on yet — please try again later.'
  if (/already.*(linked|exists|registered)|identity_already_exists/i.test(m)) {
    return 'That account is already used by another GreenFeast login. Contact us and we’ll merge them.'
  }
  return 'Could not link the account. Please try again.'
}

export default function LinkedAccountsCard() {
  const user = useAuthStore((s) => s.user)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [busy, setBusy] = useState<Provider | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable)
  }, [])

  const linked = new Set((user?.identities ?? []).map((i) => i.provider))

  async function refresh() {
    // Pull the updated identities into the store.
    const { data } = await supabase.auth.refreshSession()
    if (data.session) useAuthStore.getState().setSession(data.session)
  }

  async function linkGoogle() {
    const redirectTo = makeRedirectUri({ scheme: 'greenfeast', path: '/' })
    const { data, error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error || !data?.url) throw error ?? new Error('No link URL')
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
    if (result.type !== 'success') return false
    const { queryParams } = Linking.parse(result.url)
    if (queryParams?.error_description) throw new Error(String(queryParams.error_description))
    const code = queryParams?.code as string | undefined
    // The root layout's link listener may already have exchanged this code;
    // a second exchange fails harmlessly, the identity check below decides.
    if (code) await supabase.auth.exchangeCodeForSession(code).catch(() => {})
    return true
  }

  async function linkApple() {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    })
    if (!credential.identityToken) throw new Error('No Apple token')
    const { error } = await supabase.auth.linkIdentity({ provider: 'apple', token: credential.identityToken })
    if (error) throw error
    return true
  }

  async function link(provider: Provider) {
    setBusy(provider)
    setMessage(null)
    try {
      const went = provider === 'google' ? await linkGoogle() : await linkApple()
      if (!went) return
      await refresh()
      const { data } = await supabase.auth.getUser()
      if ((data.user?.identities ?? []).some((i) => i.provider === provider)) {
        setMessage({ ok: true, text: `${provider === 'google' ? 'Google' : 'Apple'} linked — you can now sign in with it too.` })
      } else {
        setMessage({ ok: false, text: friendly(undefined) })
      }
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return // closed the Apple sheet
      setMessage({ ok: false, text: friendly(e?.message) })
    } finally {
      setBusy(null)
    }
  }

  const rows: { provider: Provider | 'email'; label: string; show: boolean }[] = [
    { provider: 'email', label: 'Email & password', show: linked.has('email') },
    { provider: 'google', label: 'Google', show: true },
    { provider: 'apple', label: 'Apple', show: linked.has('apple') || appleAvailable },
  ]

  return (
    <View style={st.card}>
      <Text style={st.title}>Sign-in methods</Text>
      <Text style={st.sub}>Link another way to sign in to this same account.</Text>
      {rows.filter((r) => r.show).map((r) => {
        const isLinked = linked.has(r.provider)
        return (
          <View key={r.provider} style={st.row}>
            <Text style={st.label}>{r.label}</Text>
            {isLinked ? (
              <View style={st.linkedPill}><Check size={14} color={Colors.primary} /><Text style={st.linkedText}>Linked</Text></View>
            ) : r.provider === 'email' ? null : (
              <Pressable
                style={({ pressed }) => [st.linkBtn, pressed && { opacity: 0.7 }]}
                disabled={!!busy}
                onPress={() => link(r.provider as Provider)}
              >
                {busy === r.provider ? <ActivityIndicator size="small" color={Colors.primary} /> : (
                  <><Link2 size={14} color={Colors.primary} /><Text style={st.linkText}>Link</Text></>
                )}
              </Pressable>
            )}
          </View>
        )
      })}
      {message && <Text style={[st.msg, { color: message.ok ? Colors.primary : Colors.danger }]}>{message.text}</Text>}
    </View>
  )
}

const st = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: Colors.borderFaint, padding: 16, marginBottom: 12 },
  title: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.text },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderFaint },
  label: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text },
  linkedPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkedText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: Colors.primary, minWidth: 64, justifyContent: 'center' },
  linkText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },
  msg: { fontFamily: Fonts.body, fontSize: 12, marginTop: 8, lineHeight: 17 },
})
