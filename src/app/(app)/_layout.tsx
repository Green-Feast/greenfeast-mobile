import { Slot } from 'expo-router'
import { usePushNotifications } from '@/hooks/usePushNotifications'

export default function AppLayout() {
  // Register / refresh the Expo push token whenever the authenticated user
  // enters the app section. Non-fatal if device is a simulator or user denies.
  usePushNotifications()
  return <Slot />
}
