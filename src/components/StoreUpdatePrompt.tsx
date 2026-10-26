// "Update GreenFeast" — only in the 1.9.13 update for iPhones still on the
// 1.9 build (the 1.10 build's updates can't reach them over the air). Asks
// Apple's public lookup when the App Store's current version was released and
// shows only once that's later than the release these phones came from, so it
// appears by itself the moment Apple approves the new build. (Release date,
// not version: the App Store shows "1.1.0" for the 1.9 build — store version
// numbers don't follow the app's own.) "Update" opens GreenFeast's App Store
// page; "Later" hides it for 12 hours.
import { useEffect, useRef, useState } from 'react'
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Download } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'

const APP_STORE_ID = '6805608220'
const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=in`
const STORE_URL = `itms-apps://apps.apple.com/app/id${APP_STORE_ID}`
const STORE_WEB_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`
const SNOOZE_KEY = 'store_update_snoozed_at_v1'
const SNOOZE_MS = 12 * 60 * 60 * 1000
// The App Store release the 1.9 build is (version "1.1.0"), from Apple's lookup.
const RELEASE_ON_THESE_PHONES = '2026-10-02T01:55:14Z'

export default function StoreUpdatePrompt() {
  const [visible, setVisible] = useState(false)
  const checking = useRef(false)

  async function check() {
    if (Platform.OS !== 'ios' || checking.current) return
    checking.current = true
    try {
      const snoozedAt = Number(await AsyncStorage.getItem(SNOOZE_KEY)) || 0
      if (Date.now() - snoozedAt < SNOOZE_MS) return
      const res = await fetch(LOOKUP_URL)
      const json = await res.json()
      const released: string | undefined = json?.results?.[0]?.currentVersionReleaseDate
      if (released && Date.parse(released) > Date.parse(RELEASE_ON_THESE_PHONES)) setVisible(true)
    } catch {
      // offline or Apple unreachable — just don't show it
    } finally {
      checking.current = false
    }
  }

  useEffect(() => {
    check()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check()
    })
    return () => sub.remove()
  }, [])

  async function openStore() {
    try {
      await Linking.openURL(STORE_URL)
    } catch {
      Linking.openURL(STORE_WEB_URL).catch(() => {})
    }
  }

  async function later() {
    setVisible(false)
    await AsyncStorage.setItem(SNOOZE_KEY, String(Date.now())).catch(() => {})
  }

  if (!visible) return null
  return (
    <Modal visible transparent animationType="fade" onRequestClose={later}>
      <View style={st.overlay}>
        <View style={st.card}>
          <View style={st.icon}>
            <Download size={26} color={Colors.primary} />
          </View>
          <Text style={st.title}>Update GreenFeast</Text>
          <Text style={st.body}>
            A new version is on the App Store — with the 60-meal plan, coupons and the latest fixes. Update to keep everything working.
          </Text>
          <Pressable style={({ pressed }) => [st.primaryBtn, pressed && { opacity: 0.85 }]} onPress={openStore} accessibilityRole="button">
            <Text style={st.primaryText}>Update on the App Store</Text>
          </Pressable>
          <Pressable style={st.laterBtn} onPress={later} hitSlop={8} accessibilityRole="button">
            <Text style={st.laterText}>Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 16, alignItems: 'center' },
  icon: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.green50, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontFamily: Fonts.headingSemi, fontSize: 22, color: Colors.text, textAlign: 'center' },
  body: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  primaryBtn: { alignSelf: 'stretch', backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  primaryText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  laterBtn: { paddingVertical: 12, paddingHorizontal: 24, marginTop: 4 },
  laterText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textMuted },
})
