// All calendar math is done in IST (UTC+5:30) so the week strip and "today"
// never disagree around midnight, regardless of the device timezone.
const IST_MS = 5.5 * 60 * 60 * 1000

export function istToday(): string {
  return new Date(Date.now() + IST_MS).toISOString().split('T')[0]
}

export function istHour(): number {
  return new Date(Date.now() + IST_MS).getUTCHours()
}

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

// Mon=0 … Sun=6
export function dowMon0(iso: string): number {
  return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7
}

// Last day of iso's month, as an ISO date string.
export function endOfMonthISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return d.toISOString().split('T')[0]
}

// Per-slot, same-day cutoffs: lunch locks 8 AM, dinner locks 1 PM, both IST,
// both on the delivery date itself (not the night before — the kitchen needs
// a hard stop before it starts on each slot, not a day's advance notice).
export const SLOT_CUTOFF_HOUR: Record<'lunch' | 'dinner', number> = {
  lunch: 8,
  dinner: 13,
}

// A slot is locked (can't be swapped/added-to/skipped) if its delivery date is
// in the past, or it's today and the slot's cutoff hour has passed. Enforced
// server-side too — see `is_slot_locked` (migration 031) — since edit
// endpoints must never trust the client's clock. Shared by subscription.tsx's
// day cart, Home's quick-add cards, and AddToDaySheet so all three agree.
export function isSlotLocked(dateStr: string, slot: 'lunch' | 'dinner'): boolean {
  const today = istToday()
  if (dateStr < today) return true
  if (dateStr > today) return false
  return istHour() >= SLOT_CUTOFF_HOUR[slot]
}

// Whole-day lock (both slots past cutoff) — for UI that shows one lock state
// per day rather than per slot (e.g. AddToDaySheet's day chips).
export function isDayFullyLocked(dateStr: string): boolean {
  return isSlotLocked(dateStr, 'lunch') && isSlotLocked(dateStr, 'dinner')
}
