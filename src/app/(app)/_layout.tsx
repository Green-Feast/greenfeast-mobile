import { Stack } from 'expo-router'
import { usePushNotifications } from '@/hooks/usePushNotifications'

export default function AppLayout() {
  usePushNotifications()
  // Stack instead of Slot so that screens pushed on top of tabs (e.g.
  // plan-settings) have a real navigation history and back-swipe works.
  return <Stack screenOptions={{ headerShown: false }} />
}
