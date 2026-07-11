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

// A delivery is locked (can't be swapped/added-to) if it's today/past, or
// tomorrow after 8 PM IST. Shared by subscription.tsx's day cart and Home's
// quick-add cards so both enforce the exact same cutoff.
export function isDeliveryLocked(dateStr: string): boolean {
  const today = istToday()
  if (dateStr <= today) return true
  return dateStr === addDaysISO(today, 1) && istHour() >= 20
}
