import { useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useUpdates } from 'expo-updates'
import { useNotificationStore } from '@/store/notifications'
import { APP_VERSION_STRING } from '@/constants/version'

const LAST_SEEN_UPDATE_KEY = 'last_seen_update_id_v1'

/**
 * Bridges expo-updates lifecycle into the in-app notification history:
 * - When a new update finishes downloading in the background, logs
 *   "Update downloaded — reopen the app to install."
 * - The first time this app instance launches on a new updateId (OTA or a
 *   fresh native build), logs "Update installed."
 * Mount once at the app root — it doesn't depend on auth state.
 */
export function useOtaNotifications() {
  const { currentlyRunning, isUpdatePending } = useUpdates()
  const hydrated = useNotificationStore((s) => s.hydrated)
  const hydrate = useNotificationStore((s) => s.hydrate)
  const add = useNotificationStore((s) => s.add)
  const announcedPending = useRef(false)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!hydrated || announcedPending.current) return
    if (isUpdatePending) {
      announcedPending.current = true
      add('Update downloaded', 'Reopen the app to install the latest update.')
    }
  }, [hydrated, isUpdatePending, add])

  useEffect(() => {
    if (!hydrated) return
    const updateId = currentlyRunning.updateId
    if (!updateId) return
    ;(async () => {
      try {
        const lastSeen = await AsyncStorage.getItem(LAST_SEEN_UPDATE_KEY)
        if (lastSeen && lastSeen !== updateId) {
          await add('Update installed', `GreenFeast v${APP_VERSION_STRING} is now running.`)
        }
        if (lastSeen !== updateId) {
          await AsyncStorage.setItem(LAST_SEEN_UPDATE_KEY, updateId)
        }
      } catch {
        // best-effort — a missed "installed" log isn't critical
      }
    })()
  }, [hydrated, currentlyRunning.updateId, add])
}
