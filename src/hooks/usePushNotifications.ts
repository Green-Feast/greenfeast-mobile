import { useEffect } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'

// Configure how notifications appear while the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

async function registerForPushNotifications(userId: string) {
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

export function usePushNotifications() {
  const { user } = useAuthStore()

  useEffect(() => {
    if (!user?.id) return
    registerForPushNotifications(user.id)
  }, [user?.id])
}
