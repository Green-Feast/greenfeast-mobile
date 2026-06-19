import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { OTPWidget } from '@/lib/otp'

const WIDGET_ID = '36666c694641343730323737'
const TOKEN_AUTH = '526029Tz8Zwoktr6a2bd607P1'

export default function OnboardingLayout() {
  useEffect(() => {
    OTPWidget.initializeWidget(WIDGET_ID, TOKEN_AUTH)
  }, [])

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
  )
}
