import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, CheckCircle2, SkipForward, XCircle, MapPin, Plus } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import { istToday } from '@/lib/ist'

// Order history: every meal so far — what was delivered (dish, portions,
// add-ons, extra dishes, where it went), what was skipped and why, and what
// each one cost from the wallet. The wallet's transaction list says where the
// money went; this says what it bought.

type HistoryOrder = {
  id: string
  delivery_date: string
  meal_slot: 'lunch' | 'dinner'
  status: string
  skip_reason: string | null
  quantity: number | null
  extra_dish: boolean | null
  cart_total: number | null
  delivered_at: string | null
  meal_templates: { name: string; image_url: string | null; kcal: number | null } | null
  addresses: { label: string | null } | null
  order_addons: { kind: string; label: string | null; quantity: number | null; unit_price: number | null; addons: { name: string } | null }[]
}

type Group = { key: string; date: string; slot: 'lunch' | 'dinner'; orders: HistoryOrder[] }
type Filter = 'all' | 'delivered' | 'skipped'

const PAGE = 20

const SKIP_TEXT: Record<string, string> = {
  user: 'You skipped it',
  admin: 'Skipped by GreenFeast',
  insufficient_balance: 'Skipped — wallet was short',
  plan_finished: 'Skipped — plan had finished',
  kitchen_closed: 'Kitchen closed',
  pause: 'Plan paused',
  not_delivered: "Couldn't be delivered",
}

function fmt(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

function fmtDay(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function groupOrders(rows: HistoryOrder[]): Group[] {
  const map = new Map<string, Group>()
  for (const o of rows) {
    const key = `${o.delivery_date}|${o.meal_slot}`
    if (!map.has(key)) map.set(key, { key, date: o.delivery_date, slot: o.meal_slot, orders: [] })
    map.get(key)!.orders.push(o)
  }
  return Array.from(map.values())
}

// A plan add-on is included once per portion; others carry their own count.
function addonsText(o: HistoryOrder) {
  return (o.order_addons ?? [])
    .filter((l) => l.kind === 'addon' && l.addons?.name)
    .map((l) => {
      const n = (l.quantity ?? 1) * (l.unit_price == null && !o.extra_dish ? (o.quantity ?? 1) : 1)
      return n > 1 ? `${l.addons!.name} ×${n}` : l.addons!.name
    })
}

export default function OrderHistoryScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuthStore()

  const [rows, setRows] = useState<HistoryOrder[]>([])
  const [charges, setCharges] = useState<Map<string, number>>(new Map())
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [summary, setSummary] = useState<{ meals: number; spent: number } | null>(null)

  const loadPage = useCallback(async (offset: number, which: Filter): Promise<HistoryOrder[]> => {
    if (!user) return []
    const statuses = which === 'delivered' ? ['delivered'] : which === 'skipped' ? ['skipped', 'cancelled'] : ['delivered', 'skipped', 'cancelled']
    const { data } = await supabase
      .from('orders')
      .select(`
        id, delivery_date, meal_slot, status, skip_reason, quantity, extra_dish, cart_total, delivered_at,
        meal_templates ( name, image_url, kcal ),
        addresses ( label ),
        order_addons ( kind, label, quantity, unit_price, addons ( name ) )
      `)
      .eq('user_id', user.id)
      .lte('delivery_date', istToday())
      .in('status', statuses)
      .order('delivery_date', { ascending: false })
      // 'dinner' < 'lunch': the day's dinner shows above its lunch.
      .order('meal_slot', { ascending: true })
      .order('slot_seq', { ascending: true })
      .range(offset, offset + PAGE - 1)
    const page = ((data ?? []) as unknown as HistoryOrder[])
      // A removed extra dish isn't history worth showing.
      .filter((o) => !(o.status === 'cancelled' && o.extra_dish && !o.skip_reason))

    // What each delivered meal cost: its wallet debit (reference = order id).
    const ids = page.filter((o) => o.status === 'delivered').map((o) => o.id)
    if (ids.length) {
      const { data: tx } = await supabase
        .from('wallet_transactions')
        .select('reference_id, amount')
        .eq('user_id', user.id)
        .eq('type', 'debit')
        .in('reference_id', ids)
      setCharges((prev) => {
        const next = new Map(prev)
        for (const t of (tx ?? []) as { reference_id: string; amount: number }[]) next.set(t.reference_id, t.amount)
        return next
      })
    }
    setHasMore((data ?? []).length === PAGE)
    return page
  }, [user])

  const loadSummary = useCallback(async () => {
    if (!user) return
    const [{ data: delivered }, { data: debits }] = await Promise.all([
      supabase.from('orders').select('quantity').eq('user_id', user.id).eq('status', 'delivered'),
      supabase.from('wallet_transactions').select('amount, reason').eq('user_id', user.id).eq('type', 'debit'),
    ])
    setSummary({
      meals: ((delivered ?? []) as { quantity: number | null }[]).reduce((n, o) => n + (o.quantity ?? 1), 0),
      spent: ((debits ?? []) as { amount: number; reason: string | null }[])
        .filter((t) => (t.reason ?? '').startsWith('Meal delivered'))
        .reduce((n, t) => n + t.amount, 0),
    })
  }, [user])

  const reload = useCallback(async (which: Filter) => {
    const first = await loadPage(0, which)
    setRows(first)
  }, [loadPage])

  useEffect(() => {
    setLoading(true)
    Promise.all([reload(filter), loadSummary()]).finally(() => setLoading(false))
  }, [filter, reload, loadSummary])

  async function onRefresh() {
    setRefreshing(true)
    await Promise.all([reload(filter), loadSummary()])
    setRefreshing(false)
  }

  async function onEndReached() {
    if (!hasMore || loadingMore || loading) return
    setLoadingMore(true)
    const more = await loadPage(rows.length, filter)
    setRows((prev) => [...prev, ...more.filter((m) => !prev.some((p) => p.id === m.id))])
    setLoadingMore(false)
  }

  const groups = groupOrders(rows)

  return (
    <View style={st.container}>
      <View style={[st.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={st.backBtn}>
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text style={st.topBarTitle}>Order history</Text>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View>
            {summary && (
              <View style={st.summaryRow}>
                <View style={st.summaryTile}>
                  <Text style={st.summaryValue}>{summary.meals}</Text>
                  <Text style={st.summaryLabel}>meals delivered</Text>
                </View>
                <View style={st.summaryTile}>
                  <Text style={st.summaryValue}>{fmt(summary.spent)}</Text>
                  <Text style={st.summaryLabel}>spent on meals</Text>
                </View>
              </View>
            )}
            <View style={st.filterRow}>
              {(['all', 'delivered', 'skipped'] as const).map((f) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={[st.filterChip, filter === f && st.filterChipActive]}>
                  <Text style={[st.filterText, filter === f && st.filterTextActive]}>
                    {f === 'all' ? 'All' : f === 'delivered' ? 'Delivered' : 'Skipped'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 48 }} />
          ) : (
            <Text style={st.empty}>No meals here yet — your delivered and skipped meals will show up here.</Text>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={Colors.primary} style={{ marginVertical: 16 }} /> : null}
        renderItem={({ item }) => <GroupCard group={item} charges={charges} />}
      />
    </View>
  )
}

function GroupCard({ group, charges }: { group: Group; charges: Map<string, number> }) {
  const delivered = group.orders.filter((o) => o.status === 'delivered')
  const allDelivered = delivered.length === group.orders.length
  const noneDelivered = delivered.length === 0
  const charged = delivered.reduce((n, o) => n + (charges.get(o.id) ?? o.cart_total ?? 0), 0)
  const portions = group.orders.reduce((n, o) => n + (o.status === 'delivered' ? (o.quantity ?? 1) : 0), 0)
  const first = group.orders[0]
  const deliveredAt = delivered.map((o) => o.delivered_at).filter((t): t is string => !!t).sort().pop()

  return (
    <View style={st.card}>
      <View style={st.cardHeader}>
        <View>
          <Text style={st.cardDate}>{fmtDay(group.date)}</Text>
          <Text style={st.cardSlot}>{group.slot === 'lunch' ? 'Lunch' : 'Dinner'}</Text>
        </View>
        {allDelivered ? (
          <View style={[st.chip, st.chipDone]}>
            <CheckCircle2 size={13} color={Colors.primary} />
            <Text style={[st.chipText, { color: Colors.primary }]}>
              Delivered{deliveredAt ? ` ${new Date(deliveredAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : ''}
            </Text>
          </View>
        ) : noneDelivered ? (
          <View style={[st.chip, st.chipSkip]}>
            {first.status === 'cancelled' ? <XCircle size={13} color={Colors.textMuted} /> : <SkipForward size={13} color={Colors.textMuted} />}
            <Text style={[st.chipText, { color: Colors.textMuted }]}>{SKIP_TEXT[first.skip_reason ?? ''] ?? (first.status === 'cancelled' ? 'Cancelled' : 'Skipped')}</Text>
          </View>
        ) : (
          <View style={[st.chip, st.chipDone]}>
            <Text style={[st.chipText, { color: Colors.primary }]}>Partly delivered</Text>
          </View>
        )}
      </View>

      {group.orders.map((o) => {
        const addons = addonsText(o)
        const out = o.status !== 'delivered'
        return (
          <View key={o.id} style={[st.row, out && { opacity: 0.55 }]}>
            {o.meal_templates?.image_url ? (
              <Image source={{ uri: o.meal_templates.image_url }} style={st.thumb} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[st.thumb, st.thumbEmpty]}><Text style={{ fontSize: 18 }}>🍽️</Text></View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={st.dish} numberOfLines={2}>
                {o.extra_dish && <Plus size={12} color={Colors.primary} />}
                {o.meal_templates?.name ?? 'Meal'}
              </Text>
              <Text style={st.meta}>
                {(o.quantity ?? 1)} portion{(o.quantity ?? 1) === 1 ? '' : 's'}
                {o.extra_dish ? ' · extra dish' : ''}
                {o.meal_templates?.kcal ? ` · ${o.meal_templates.kcal * (o.quantity ?? 1)} kcal` : ''}
              </Text>
              {addons.length > 0 && <Text style={st.addons}>+ {addons.join(', ')}</Text>}
              {o.addresses?.label && (
                <View style={st.addrRow}>
                  <MapPin size={11} color={Colors.textMuted} />
                  <Text style={st.addrText}>{o.addresses.label}</Text>
                </View>
              )}
            </View>
            {o.status === 'delivered' && (
              <Text style={st.price}>{fmt(charges.get(o.id) ?? o.cart_total ?? 0)}</Text>
            )}
          </View>
        )
      })}

      <View style={st.cardFooter}>
        <Text style={st.footerText}>
          {noneDelivered ? 'Nothing charged — the meal stayed on your plan' : `${portions} meal${portions === 1 ? '' : 's'} from your plan`}
        </Text>
        {!noneDelivered && <Text style={st.footerTotal}>{fmt(charged)}</Text>}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
  backBtn: { padding: 4 },
  topBarTitle: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.text },

  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  summaryTile: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  summaryValue: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.text },
  summaryLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#fff' },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text },
  filterTextActive: { color: '#fff' },

  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 48, paddingHorizontal: 24, lineHeight: 20 },

  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  cardDate: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted },
  cardSlot: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.text, marginTop: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  chipDone: { backgroundColor: Colors.primaryLight },
  chipSkip: { backgroundColor: Colors.borderFaint },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 11 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.borderFaint },
  thumb: { width: 48, height: 48, borderRadius: 12 },
  thumbEmpty: { backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  dish: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addons: { fontFamily: Fonts.body, fontSize: 12, color: Colors.primary, marginTop: 2 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  addrText: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  price: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: Colors.borderFaint, paddingTop: 10, marginTop: 2 },
  footerText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, flex: 1, paddingRight: 8 },
  footerTotal: { fontFamily: Fonts.heading, fontSize: 16, color: Colors.text },
})
