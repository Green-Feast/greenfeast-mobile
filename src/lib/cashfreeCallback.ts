import { CFPaymentGatewayService, type CFCallback } from 'react-native-cashfree-pg-sdk'

// CFPaymentGatewayService is a process-wide singleton with exactly one
// active callback slot: setCallback() overwrites it with no regard for who
// registered the previous one, and removeCallback() tears down whatever is
// CURRENTLY registered, regardless of who calls it. Two screens use it —
// My Plan's wallet top-up and onboarding's payment — and since expo-router
// keeps a screen mounted underneath whatever gets pushed on top of it, My
// Plan's callback-registering effect is already live (My Plan renders
// SubscribeGate for a brand-new user, but the effect that registers this
// callback runs unconditionally before that early return) by the time
// onboarding's payment screen mounts and registers its own callback. If
// either screen's cleanup then fires out of order, it can silently unhook
// the OTHER screen's live listener — very plausibly the root cause behind
// "payment succeeds, wallet is charged, but onboarding never receives the
// result and sits stuck spinning forever."
//
// Fix: only the registration that's still "current" is allowed to clear the
// slot. A stale cleanup — from a screen whose registration has since been
// superseded by another screen's — becomes a no-op instead of tearing down
// the listener that's actually in use.
let activeToken = 0

export function setActiveCashfreeCallback(callback: CFCallback): () => void {
  const token = ++activeToken
  CFPaymentGatewayService.setCallback(callback)
  return () => {
    if (activeToken === token) {
      CFPaymentGatewayService.removeCallback()
    }
    // else: a newer registration has since taken the slot — leave it alone.
  }
}
