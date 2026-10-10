import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'

// iOS users rarely swipe the app away, so a tab can sit in memory for days
// showing whatever it loaded first. This silently re-runs `refresh` while the
// screen is in use, so admin-side changes (menu swaps, delivered status,
// wallet debits) show up without the user doing anything:
//   - when the tab gains focus (tab switch / coming back from a modal)
//   - when the app returns to the foreground
//   - every `intervalMs` while the tab is focused and the app is active
// Focus/foreground refreshes are skipped if the last one was under `minGapMs`
// ago, and overlapping runs are dropped. Pull-to-refresh stays with the screen.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_MIN_GAP_MS = 30 * 1000

export function useAutoRefresh(
  refresh: () => Promise<unknown> | void,
  { enabled = true, intervalMs = DEFAULT_INTERVAL_MS, minGapMs = DEFAULT_MIN_GAP_MS } = {}
) {
  // Always call the latest closure without re-subscribing listeners.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Initial loads are the screen's own job, so count mount as "just ran".
  const lastRun = useRef(Date.now())
  const inFlight = useRef(false)
  const focused = useRef(false)

  const run = useCallback(async (force: boolean) => {
    if (!enabled || inFlight.current) return
    if (!force && Date.now() - lastRun.current < minGapMs) return
    inFlight.current = true
    lastRun.current = Date.now()
    try {
      await refreshRef.current()
    } catch (e) {
      console.warn('[useAutoRefresh] refresh failed:', e)
    } finally {
      inFlight.current = false
    }
  }, [enabled, minGapMs])

  // Tab focus + periodic timer (timer only lives while the tab is focused).
  useFocusEffect(
    useCallback(() => {
      focused.current = true
      run(false)
      const id = setInterval(() => {
        if (AppState.currentState === 'active') run(true)
      }, intervalMs)
      return () => {
        focused.current = false
        clearInterval(id)
      }
    }, [run, intervalMs])
  )

  // Foreground. JS timers don't fire while backgrounded on iOS, so this is
  // what catches "opened the app again hours later".
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused.current) run(false)
    })
    return () => sub.remove()
  }, [run])
}
