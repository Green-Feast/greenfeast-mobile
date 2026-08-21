// Temporary cold-start timing instrumentation (1.9.0 diagnosis) — remove once
// the "few seconds on both platforms" + "brief name-screen flash" bugs are
// root-caused. Tagged [ColdStart] for easy `adb logcat` / device-log
// filtering; ms is wall-clock since this module first evaluated, which is
// effectively JS-bundle-start on a cold launch.
const COLD_START_T0 = Date.now()

export function logColdStart(label: string) {
  console.log(`[ColdStart] ${label} at +${Date.now() - COLD_START_T0}ms`)
}
