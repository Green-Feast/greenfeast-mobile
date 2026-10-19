import { Stack } from 'expo-router'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { RatingSheetHost } from '@/components/RateMealSheet'

export default function AppLayout() {
  usePushNotifications()
  // Stack instead of Slot so that screens pushed on top of tabs (e.g.
  // plan-settings) have a real navigation history and back-swipe works.
  // The meal-rating sheet lives here so a push can open it on any screen.
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <RatingSheetHost />
    </>
  )
}
