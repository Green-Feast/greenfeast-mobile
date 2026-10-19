import { useEffect } from 'react'
import { useNotificationStore } from '@/store/notifications'
import { Platform } from 'react-native'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { useRatingStore } from '@/store/rating'

// expo-notifications' push module was removed from Expo Go (SDK 53+) and throws
// at *import* time there. So we must not statically import it — only require it
// in real builds. In Expo Go, push is a no-op; use a dev/preview build to test.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

let Notifications: typeof import('expo-notifications') | null = null
let Device: typeof import('expo-device') | null = null

if (!isExpoGo) {
  Notifications = require('expo-notifications')
  Device = require('expo-device')

  // Configure how notifications appear while the app is in the foreground
  Notifications!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
}

async function registerForPushNotifications(userId: string) {
  // Skip entirely in Expo Go — the native push module isn't available there.
  if (isExpoGo || !Notifications || !Device) return

  // Push tokens only work on physical devices
  if (!Device.isDevice) return

  // Android 13+ requires explicit permission
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'GreenFeast',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1B5E20',
    })
  }

  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
  if (!projectId) {
    console.warn('usePushNotifications: EAS projectId not found in app config')
    return
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    // Only write to DB if the token changed (avoids unnecessary writes on every app open)
    const { data: user } = await supabase
      .from('users')
      .select('expo_push_token')
      .eq('id', userId)
      .single()

    if (user?.expo_push_token !== token) {
      await supabase
        .from('users')
        .update({ expo_push_token: token })
        .eq('id', userId)
    }
  } catch (err) {
    // Non-fatal — push notifications are optional
    console.warn('Push token registration failed:', err)
  }
}

type Response = import('expo-notifications').NotificationResponse

// Tapping "How was your lunch?" (send_rating_asks, migration 064) opens the
// rating sheet for that meal. Each tap is handled once — the listener and the
// "app was opened by this tap" lookup can both report the same one.
const handledTaps = new Set<string>()
function openFromTap(response: Response | null) {
  if (!response) return
  const id = response.notification.request.identifier
  if (handledTaps.has(id)) return
  handledTaps.add(id)
  const data = response.notification.request.content.data as { type?: unknown; date?: unknown; slot?: unknown } | undefined
  if (data?.type !== 'rate_meal' || typeof data.date !== 'string' || (data.slot !== 'lunch' && data.slot !== 'dinner')) return
  useRatingStore.getState().open({ date: data.date, slot: data.slot, source: 'push' })
}

export function usePushNotifications() {
  const { user } = useAuthStore()

  useEffect(() => {
    if (isExpoGo || !user?.id) return
    registerForPushNotifications(user.id)
  }, [user?.id])

  // A push arriving (or tapped) means a new row in the bell's history.
  useEffect(() => {
    if (!Notifications || !user?.id) return
    const N = Notifications
    const userId = user.id
    const refresh = () => { useNotificationStore.getState().loadRemote(userId) }
    refresh()
    const received = N.addNotificationReceivedListener(refresh)
    const tapped = N.addNotificationResponseReceivedListener((response) => { refresh(); openFromTap(response) })
    // The app was started by tapping a push (before the listener existed).
    try {
      openFromTap(N.getLastNotificationResponse())
      N.clearLastNotificationResponse()
    } catch {
      N.getLastNotificationResponseAsync().then(openFromTap).catch(() => {})
    }
    return () => { received.remove(); tapped.remove() }
  }, [user?.id])
}
