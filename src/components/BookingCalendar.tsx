import { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'
import { istToday, addDaysISO, dowMon0, endOfMonthISO } from '@/lib/ist'

// Hotel-booking-style month calendar: a header with month paging, a 7-column
// grid, and (in range mode) a connected tint band between the picked start
// and end dates. No external calendar dependency.

function firstOfMonthISO(iso: string): string {
  return iso.slice(0, 7) + '-01'
}
function addMonthsISO(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number)
  const total = m - 1 + n
  const year = y + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12 + 1
  return `${year}-${String(month).padStart(2, '0')}-01`
}
function monthLabel(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
function dayNum(iso: string): number {
  return Number(iso.slice(8, 10))
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

type BookingCalendarProps =
  | {
      mode: 'single'
      minDate: string
      maxDate?: string
      isDayEnabled?: (iso: string) => boolean
      value: string | null
      onChange: (value: string) => void
    }
  | {
      mode: 'range'
      minDate: string
      maxDate?: string
      isDayEnabled?: (iso: string) => boolean
      start: string | null
      end: string | null
      onChange: (start: string | null, end: string | null) => void
    }

export default function BookingCalendar(props: BookingCalendarProps) {
  const { mode, minDate, maxDate, isDayEnabled } = props
  const [viewMonth, setViewMonth] = useState(() => firstOfMonthISO(minDate))
  const today = istToday()

  const minMonth = firstOfMonthISO(minDate)
  const maxMonth = maxDate ? firstOfMonthISO(maxDate) : null
  const canGoPrev = viewMonth > minMonth
  const canGoNext = !maxMonth || viewMonth < maxMonth

  const lastOfMonth = endOfMonthISO(viewMonth)
  const leadingBlanks = dowMon0(viewMonth)
  const totalDays = dayNum(lastOfMonth)
  const cells: (string | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => addDaysISO(viewMonth, i)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function isDisabled(iso: string): boolean {
    if (iso < minDate) return true
    if (maxDate && iso > maxDate) return true
    if (isDayEnabled && !isDayEnabled(iso)) return true
    return false
  }

  function handlePress(iso: string) {
    if (isDisabled(iso)) return
    if (mode === 'single') {
      props.onChange(iso)
      return
    }
    const { start, end } = props
    if (!start) { props.onChange(iso, null); return }
    if (!end) {
      if (iso > start) props.onChange(start, iso)
      else props.onChange(iso, null)
      return
    }
    props.onChange(iso, null)
  }

  return (
    <View>
      <View style={cs.header}>
        <Pressable onPress={() => canGoPrev && setViewMonth(addMonthsISO(viewMonth, -1))} disabled={!canGoPrev} hitSlop={10}>
          <ChevronLeft size={20} color={canGoPrev ? Colors.text : Colors.textLight} />
        </Pressable>
        <Text style={cs.monthLabel}>{monthLabel(viewMonth)}</Text>
        <Pressable onPress={() => canGoNext && setViewMonth(addMonthsISO(viewMonth, 1))} disabled={!canGoNext} hitSlop={10}>
          <ChevronRight size={20} color={canGoNext ? Colors.text : Colors.textLight} />
        </Pressable>
      </View>

      <View style={cs.weekdayRow}>
        {WEEKDAY_LABELS.map((w) => <Text key={w} style={cs.weekdayLabel}>{w}</Text>)}
      </View>

      <View style={cs.grid}>
        {cells.map((iso, i) => {
          if (!iso) return <View key={`blank-${i}`} style={cs.cell} />
          const disabled = isDisabled(iso)
          const isToday = iso === today
          let isSelected = false
          let inRange = false
          if (mode === 'single') {
            isSelected = iso === props.value
          } else {
            isSelected = iso === props.start || iso === props.end
            inRange = !!(props.start && props.end && iso > props.start && iso < props.end)
          }
          // Connected pill band (not a per-day square): only once both ends are
          // picked, tint the whole span including the start/end days themselves
          // — otherwise the selected circle sits on a bare cell with a visible
          // gap where it should merge into the band — and round off the true
          // start/end and each row's first/last column so it reads as one
          // continuous shape per row instead of a stack of hard-edged blocks.
          const spanning = mode === 'range' && !!(props.start && props.end)
          const inTint = spanning && (isSelected || inRange)
          const col = dowMon0(iso)
          const capLeft = inTint && (col === 0 || (mode === 'range' && iso === props.start))
          const capRight = inTint && (col === 6 || (mode === 'range' && iso === props.end))
          return (
            <Pressable
              key={iso}
              onPress={() => handlePress(iso)}
              disabled={disabled}
              style={[cs.cell, inTint && cs.cellInRangeBg, capLeft && cs.cellCapLeft, capRight && cs.cellCapRight]}
            >
              <View style={[cs.cellInner, isToday && !isSelected && cs.cellToday, isSelected && cs.cellSelected]}>
                <Text style={[cs.cellText, isSelected && cs.cellTextSelected, disabled && cs.cellTextDisabled]}>
                  {dayNum(iso)}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const cs = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 },
  monthLabel: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.text },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekdayLabel: { flexBasis: '14.2857%', textAlign: 'center', fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textLight, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexBasis: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellInRangeBg: { backgroundColor: Colors.primaryLight },
  cellCapLeft: { borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  cellCapRight: { borderTopRightRadius: 16, borderBottomRightRadius: 16 },
  cellInner: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cellToday: { borderWidth: 1.5, borderColor: Colors.primary },
  cellSelected: { backgroundColor: Colors.primary },
  cellText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.text },
  cellTextSelected: { color: '#fff', fontFamily: Fonts.bodySemi },
  cellTextDisabled: { color: Colors.textLight },
})
