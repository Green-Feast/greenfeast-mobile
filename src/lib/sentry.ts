// Crash + error reporting.
//
// Initialised as early as possible (imported at the top of app/_layout.tsx)
// so errors thrown during boot — the exact class of bug that produced the
// dead 1.8.0 Android build — are still captured.
//
// No-ops entirely when EXPO_PUBLIC_SENTRY_DSN is unset, so local dev and any
// build made before the DSN was configured behave exactly as before rather
// than throwing at startup.
import * as Sentry from '@sentry/react-native'
import { APP_VERSION_STRING } from '@/constants/version'

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN

export const sentryEnabled = !!DSN && !__DEV__

export function initSentry() {
  if (!DSN) return
  Sentry.init({
    dsn: DSN,
    // Local dev already surfaces errors in the console/redbox; sending them
    // just pollutes the issue list with noise from half-written code.
    enabled: !__DEV__,
    // Tagged with the app's own MAJOR.BUILD.OTA scheme (see VERSION.md), not
    // just the native version, so an issue can be traced to the exact OTA
    // that introduced it — the native version alone can't distinguish them.
    release: `greenfeast@${APP_VERSION_STRING}`,
    // Performance tracing off for now: it multiplies event volume and the
    // free tier's quota is better spent on actual errors during the closed
    // test. Turn on later if a latency question needs it.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  })
}

// Attach the signed-in user so an error report can be traced back to a
// specific tester's account without them having to describe what they did.
// id only — no email/phone, which keeps this consistent with the Play Data
// Safety declaration (crash logs, not personal info).
export function setSentryUser(userId: string | null) {
  if (!DSN) return
  Sentry.setUser(userId ? { id: userId } : null)
}

// Manual capture for handled errors worth knowing about (a failed payment
// callback, a stalled edge function) that don't crash the app and so would
// otherwise be invisible.
export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!DSN) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}
