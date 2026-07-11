// Bottom sheet launched from a Menu item's detail view: lets a subscriber pick
// a day (next 7) + slot (lunch/dinner) + quantity and add that dish as an
// extra for that delivery. Mirrors the add-dish flow already used by My Plan
// (src/app/(app)/(tabs)/subscription.tsx `handleAddDish`/`handleCartOp`), so
// anything added here shows up there too — same edge functions, same table.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { X, Check, Minus, Plus } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { istToday, addDaysISO, isDeliveryLocked, dowMon0 } from '@/lib/ist'
import { Colors, Fonts } from '@/constants/colors'

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type DayInfo = {
  date: string
  label: string
  refOrderId: string | null
  locked: boolean
}

type Props = {
  visible: boolean
  onClose: () => void
  meal: { id: string; name: string }
}

export default function AddToDaySheet({ visible, onClose, meal }: Props) {
  const router = useRouter()
  const { user, hasSubscription } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<DayInfo[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slot, setSlot] = useState<'lunch' | 'dinner'>('lunch')
  const [qty, setQty] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!visible) return
    setSelectedDate(null)
    setSuccess(false)
    setError('')
    setQty(1)

    if (!hasSubscription || !user) { setLoading(false); return }

    setLoading(true)
    ;(async () => {
      const today = istToday()
      const end = addDaysISO(today, 6)
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .or('status.eq.active,status.eq.paused,and(status.eq.pending,payment_method.eq.cod)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!subData) { setDays([]); setLoading(false); return }

      const { data: orders } = await supabase
        .from('orders')
        .select('id, delivery_date')
        .eq('subscription_id', subData.id)
        .gte('delivery_date', today)
        .lte('delivery_date', end)
        .in('status', ['scheduled', 'confirmed', 'preparing'])

      const list: DayInfo[] = []
      for (let i = 0; i <= 6; i++) {
        const date = addDaysISO(today, i)
        const dayOrders = (orders ?? []).filter((o) => o.delivery_date === date)
        const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : WEEKDAY[dowMon0(date)]
        list.push({
          date,
          label,
          refOrderId: dayOrders[0]?.id ?? null,
          locked: isDeliveryLocked(date),
        })
      }
      setDays(list)
      const firstOpen = list.find((d) => d.refOrderId && !d.locked)
      setSelectedDate(firstOpen?.date ?? null)
      setLoading(false)
    })()
  }, [visible, hasSubscription, user])

  async function handleAdd() {
    const day = days.find((d) => d.date === selectedDate)
    if (!day?.refOrderId) return
    setSubmitting(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const { data, error: fnError } = await supabase.functions.invoke('add-dish', {
        body: { order_id: day.refOrderId, meal_template_id: meal.id, meal_slot: slot },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (fnError) throw fnError
      if (data?.error === 'insufficient_balance') {
        setError('Insufficient wallet balance for an extra dish. Add money in My Plan first.')
        return
      }
      if (data?.error) throw new Error(data.error)

      const newOrderId = data?.order_id
      for (let i = 1; i < qty && newOrderId; i++) {
        await supabase.functions.invoke('update-day-cart', {
          body: { order_id: newOrderId, op: 'inc_qty' },
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setSuccess(true)
    } catch (e: any) {
      setError(e?.message ?? 'Could not add this dish. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedDay = days.find((d) => d.date === selectedDate)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>Add {meal.name}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={20} color={Colors.ink500} />
            </Pressable>
          </View>

          {!hasSubscription ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>Subscribe to a plan to add dishes to your daily delivery.</Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => { onClose(); router.push(user ? '/(onboarding)/health' as any : '/(auth)/login' as any) }}
              >
                <Text style={styles.primaryBtnText}>Build your plan →</Text>
              </Pressable>
            </View>
          ) : loading ? (
            <View style={styles.emptyWrap}><ActivityIndicator color={Colors.green700} /></View>
          ) : success ? (
            <View style={styles.emptyWrap}>
              <View style={styles.successIcon}><Check size={28} color="#fff" /></View>
              <Text style={styles.successText}>
                Added to {selectedDay?.label.toLowerCase()}'s {slot}. Check My Plan to review your day.
              </Text>
              <Pressable style={styles.primaryBtn} onPress={() => { onClose(); router.push('/(app)/(tabs)/subscription') }}>
                <Text style={styles.primaryBtnText}>View My Plan →</Text>
              </Pressable>
            </View>
          ) : days.every((d) => !d.refOrderId) ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No upcoming deliveries in the next 7 days to add this to yet.</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionLabel}>Choose a day</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
                {days.map((d) => {
                  const disabled = !d.refOrderId || d.locked
                  const active = d.date === selectedDate
                  return (
                    <Pressable
                      key={d.date}
                      disabled={disabled}
                      onPress={() => setSelectedDate(d.date)}
                      style={[styles.dayCell, active && styles.dayCellActive, disabled && styles.dayCellDisabled]}
                    >
                      <Text style={[styles.dayCellLabel, active && styles.dayCellLabelActive, disabled && styles.dayCellLabelDisabled]}>
                        {d.label}
                      </Text>
                      <Text style={[styles.dayCellDate, active && styles.dayCellLabelActive, disabled && styles.dayCellLabelDisabled]}>
                        {d.date.slice(8, 10)}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>

              <Text style={styles.sectionLabel}>Slot</Text>
              <View style={styles.slotToggle}>
                {(['lunch', 'dinner'] as const).map((s) => (
                  <Pressable
                    key={s}
                    style={[styles.slotBtn, slot === s && styles.slotBtnActive]}
                    onPress={() => setSlot(s)}
                  >
                    <Text style={[styles.slotBtnText, slot === s && styles.slotBtnTextActive]}>
                      {s === 'lunch' ? 'Lunch' : 'Dinner'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.sectionLabel}>Quantity</Text>
              <View style={styles.qtyStepper}>
                <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => Math.max(1, q - 1))} hitSlop={8}>
                  <Minus size={16} color={Colors.ink900} />
                </Pressable>
                <Text style={styles.qtyValue}>{qty}</Text>
                <Pressable style={styles.qtyBtn} onPress={() => setQty((q) => Math.min(5, q + 1))} hitSlop={8}>
                  <Plus size={16} color={Colors.ink900} />
                </Pressable>
              </View>

              <Text style={styles.hint}>Billed on delivery. Removable from My Plan until 8 PM the evening before.</Text>

              {!!error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                style={[styles.primaryBtn, (!selectedDay?.refOrderId || submitting) && styles.primaryBtnDisabled]}
                disabled={!selectedDay?.refOrderId || submitting}
                onPress={handleAdd}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add to cart</Text>}
              </Pressable>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.cream50,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.ink900, flex: 1, marginRight: 12 },

  sectionLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.ink500, marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },

  dayRow: { gap: 8, paddingBottom: 2 },
  dayCell: {
    width: 56, paddingVertical: 10, borderRadius: 14, alignItems: 'center',
    backgroundColor: Colors.cream200, borderWidth: 1.5, borderColor: Colors.border,
  },
  dayCellActive: { backgroundColor: Colors.green700, borderColor: Colors.green700 },
  dayCellDisabled: { opacity: 0.4 },
  dayCellLabel: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.ink500 },
  dayCellDate: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink900, marginTop: 2 },
  dayCellLabelActive: { color: '#fff' },
  dayCellLabelDisabled: { color: Colors.ink400 },

  slotToggle: { flexDirection: 'row', backgroundColor: Colors.cream200, borderRadius: 14, padding: 4, gap: 4 },
  slotBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  slotBtnActive: { backgroundColor: Colors.green700 },
  slotBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.ink500 },
  slotBtnTextActive: { color: '#fff' },

  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 20, alignSelf: 'flex-start' },
  qtyBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.cream200,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.border,
  },
  qtyValue: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink900, minWidth: 20, textAlign: 'center' },

  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink500, marginTop: 16, lineHeight: 17 },
  error: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.danger, marginTop: 12 },

  primaryBtn: {
    backgroundColor: Colors.green700, borderRadius: 999, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', marginTop: 20, minHeight: 50,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },

  emptyWrap: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 8, gap: 16 },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, textAlign: 'center', lineHeight: 20 },
  successIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.green700, alignItems: 'center', justifyContent: 'center' },
  successText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink900, textAlign: 'center', lineHeight: 20 },
})
