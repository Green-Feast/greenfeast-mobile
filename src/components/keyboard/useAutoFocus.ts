import { useCallback, useRef } from 'react'
import { InteractionManager, type TextInput } from 'react-native'
import { useFocusEffect } from 'expo-router'

/**
 * Returns a ref to attach to the first logical input on a screen. The input is
 * focused once the screen's enter transition has finished, so the keyboard
 * opens *after* the slide-in settles rather than fighting it mid-animation.
 *
 * This replaces the per-screen `autoFocus` / `InteractionManager` + `setTimeout`
 * hacks. With `react-native-keyboard-controller` driving layout there is no
 * `KeyboardAvoidingView` frame to mis-measure, so a single deferred focus is
 * enough — no magic delays.
 *
 * Uses `useFocusEffect` (not a mount effect) so the field also re-focuses if the
 * user navigates back to the screen.
 *
 * @param enabled pass false to skip autofocus (e.g. a screen that should open
 *                with the keyboard closed).
 */
export function useAutoFocus<T extends TextInput = TextInput>(enabled = true) {
  const ref = useRef<T>(null)

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return
      const task = InteractionManager.runAfterInteractions(() => {
        ref.current?.focus()
      })
      return () => task.cancel()
    }, [enabled])
  )

  return ref
}
