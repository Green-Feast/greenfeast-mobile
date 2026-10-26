// "Renew plan" sheet, shown when a plan's meals are used up. Four ways on:
// repeat the same plan, edit it, build a new plan through onboarding, or
// cancel. Repeat/edit are paid through Cashfree by the parent (My Plan owns the
// payment callback); this sheet only collects the choice and shows progress.
import { useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, Modal, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  X, RotateCcw, SlidersHorizontal, ClipboardList, XCircle, ChevronRight, ChevronLeft,
  Minus, Plus, Check, CheckCircle2, AlertCircle,
} from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'
import CouponField from '@/components/CouponField'
import { couponsAllowed, type CouponQuote } from '@/lib/coupons'

export type RenewPlanOption = { id: string; name: string; base_price: number; meals_total: number }
export type RenewAddonOption = { id: string; name: string; price_per_meal: number }
export type RenewConfig = { plan_id: string; meals_lunch: number; meals_dinner: number; addon_ids: string[] }
export type RenewPaymentState = 'idle' | 'starting' | 'paying' | 'confirming' | 'done' | 'failed'

type Step = 'menu' | 'repeat' | 'edit' | 'cancel'

const MAX_PER_SLOT = 3

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

// Same formula the server charges: plan price + add-ons per meal × meals.
function priceOf(cfg: RenewConfig, plans: RenewPlanOption[], addons: RenewAddonOption[]): number | null {
  const plan = plans.find((p) => p.id === cfg.plan_id)
  if (!plan) return null
  const perMeal = cfg.addon_ids.reduce((s, id) => s + (addons.find((a) => a.id === id)?.price_per_meal ?? 0), 0)
  return plan.base_price + perMeal * plan.meals_total
}

function mealsLine(cfg: RenewConfig) {
  const parts = []
  if (cfg.meals_lunch > 0) parts.push(`${cfg.meals_lunch} lunch`)
  if (cfg.meals_dinner > 0) parts.push(`${cfg.meals_dinner} dinner`)
  return parts.join(' + ') + ' a day'
}

export default function RenewPlanSheet({
  visible,
  onClose,
  planName,
  current,
  plans,
  addons,
  walletBalance,
  paymentState,
  paymentMessage,
  onRenew,
  onRedoOnboarding,
  onCancelPlan,
}: {
  visible: boolean
  onClose: () => void
  planName: string | null
  current: RenewConfig
  plans: RenewPlanOption[]
  addons: RenewAddonOption[]
  walletBalance: number | null
  paymentState: RenewPaymentState
  paymentMessage: string
  // couponCode: re-checked and priced by the server (migration 066).
  onRenew: (cfg: RenewConfig, couponCode?: string) => void
  onRedoOnboarding: () => void
  onCancelPlan: () => Promise<void>
}) {
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState<Step>('menu')
  const [draft, setDraft] = useState<RenewConfig>(current)
  const [cancelling, setCancelling] = useState(false)
  const [coupon, setCoupon] = useState<CouponQuote | null>(null)

  // Fresh start every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setStep('menu')
      setDraft(current)
      setCancelling(false)
      setCoupon(null)
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  // A coupon belongs to the step it was applied on (repeat vs edit).
  useEffect(() => { setCoupon(null) }, [step])

  const currentPlan = plans.find((p) => p.id === current.plan_id)
  const currentPrice = priceOf(current, plans, addons)
  const draftPrice = priceOf(draft, plans, addons)
  const busy = paymentState === 'starting' || paymentState === 'paying' || paymentState === 'confirming'
  const draftValid = draft.meals_lunch + draft.meals_dinner >= 1 && draftPrice !== null

  const currentAddonNames = useMemo(
    () => current.addon_ids.map((id) => addons.find((a) => a.id === id)?.name).filter(Boolean).join(', '),
    [current.addon_ids, addons]
  )

  function close() {
    if (busy) return
    onClose()
  }

  function setCount(slot: 'meals_lunch' | 'meals_dinner', delta: number) {
    setDraft((d) => ({ ...d, [slot]: Math.min(MAX_PER_SLOT, Math.max(0, d[slot] + delta)) }))
  }

  function toggleAddon(id: string) {
    setDraft((d) => ({
      ...d,
      addon_ids: d.addon_ids.includes(id) ? d.addon_ids.filter((x) => x !== id) : [...d.addon_ids, id],
    }))
  }

  // ── Progress / result (payment owned by the parent) ─────────────────────
  const statusView = paymentState !== 'idle' && (
    <View style={st.statusWrap}>
      {busy && <ActivityIndicator size="large" color={Colors.primary} />}
      {paymentState === 'done' && <CheckCircle2 size={44} color={Colors.primary} />}
      {paymentState === 'failed' && <AlertCircle size={44} color={Colors.danger} />}
      <Text style={st.statusTitle}>
        {paymentState === 'starting' ? 'Setting up your renewal…'
          : paymentState === 'paying' ? 'Complete the payment'
          : paymentState === 'confirming' ? 'Confirming your payment…'
          : paymentState === 'done' ? 'Plan renewed!'
          : 'Renewal didn’t go through'}
      </Text>
      {!!paymentMessage && <Text style={st.statusText}>{paymentMessage}</Text>}
      {paymentState === 'done' && (
        <Pressable style={st.primaryBtn} onPress={onClose}>
          <Text style={st.primaryBtnText}>Done</Text>
        </Pressable>
      )}
      {paymentState === 'failed' && (
        <Pressable style={st.ghostBtn} onPress={() => onRenew(step === 'edit' ? draft : current, coupon?.code)}>
          <Text style={st.ghostBtnText}>Try again</Text>
        </Pressable>
      )}
    </View>
  )

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={st.overlay} onPress={close}>
        <Pressable style={st.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={st.handle} />
          <View style={st.header}>
            {step !== 'menu' && !busy && paymentState !== 'done' ? (
              <Pressable onPress={() => setStep('menu')} hitSlop={10} style={st.headerBack}>
                <ChevronLeft size={20} color={Colors.textMuted} />
              </Pressable>
            ) : <View style={st.headerBack} />}
            <Text style={st.headerTitle}>
              {step === 'menu' ? 'Renew your plan'
                : step === 'repeat' ? 'Repeat your plan'
                : step === 'edit' ? 'Edit your plan'
                : 'Cancel plan'}
            </Text>
            <Pressable onPress={close} hitSlop={10} style={st.headerBack}>
              {!busy && <X size={20} color={Colors.textMuted} />}
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24 + insets.bottom }} showsVerticalScrollIndicator={false}>
            {statusView || (
              <>
                {step === 'menu' && (
                  <>
                    <Text style={st.lead}>
                      All the meals on your {planName ?? 'plan'} are used up. How would you like to continue?
                    </Text>
                    {[
                      {
                        icon: RotateCcw, title: 'Repeat the same plan',
                        sub: currentPlan && currentPrice !== null
                          ? `${currentPlan.name} · ${mealsLine(current)} · ${rupees(currentPrice)}`
                          : 'Same meals, same add-ons',
                        onPress: () => setStep('repeat'),
                      },
                      { icon: SlidersHorizontal, title: 'Edit plan', sub: 'Change plan size, meals per day or add-ons', onPress: () => setStep('edit') },
                      { icon: ClipboardList, title: 'Build a new plan', sub: 'Answer a few questions again for a fresh recommendation', onPress: onRedoOnboarding },
                      { icon: XCircle, title: 'Cancel plan', sub: 'Stop your meals. Money in your wallet stays yours.', onPress: () => setStep('cancel'), danger: true },
                    ].map(({ icon: Icon, title, sub, onPress, danger }) => (
                      <Pressable key={title} style={({ pressed }) => [st.option, pressed && { opacity: 0.8 }]} onPress={onPress}>
                        <View style={[st.optionIcon, danger && { backgroundColor: Colors.dangerLight }]}>
                          <Icon size={18} color={danger ? Colors.danger : Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[st.optionTitle, danger && { color: Colors.danger }]}>{title}</Text>
                          <Text style={st.optionSub}>{sub}</Text>
                        </View>
                        <ChevronRight size={18} color={Colors.textLight} />
                      </Pressable>
                    ))}
                  </>
                )}

                {step === 'repeat' && (
                  <>
                    <View style={st.card}>
                      <Text style={st.cardTitle}>{currentPlan?.name ?? 'Your plan'}</Text>
                      <Text style={st.cardLine}>{currentPlan ? `${currentPlan.meals_total} meals` : ''}{currentPlan ? ' · ' : ''}{mealsLine(current)}</Text>
                      <Text style={st.cardLine}>{currentAddonNames ? `Add-ons: ${currentAddonNames}` : 'No add-ons'}</Text>
                      <Text style={st.cardNote}>Delivery days, menu and address stay the same.</Text>
                    </View>
                    {walletBalance !== null && walletBalance > 0 && (
                      <Text style={st.walletNote}>The {rupees(walletBalance)} already in your wallet stays and is used first.</Text>
                    )}
                    {currentPrice !== null && couponsAllowed(current.plan_id) && (
                      <CouponField planId={current.plan_id} addonIds={current.addon_ids} applied={coupon} onChange={setCoupon} />
                    )}
                    <Pressable
                      style={[st.primaryBtn, currentPrice === null && st.btnDisabled]}
                      disabled={currentPrice === null}
                      onPress={() => onRenew(current, coupon?.code)}
                    >
                      <Text style={st.primaryBtnText}>
                        {currentPrice !== null ? `Pay ${rupees(coupon ? coupon.total : currentPrice)}` : 'Plan unavailable'}
                      </Text>
                    </Pressable>
                  </>
                )}

                {step === 'edit' && (
                  <>
                    <Text style={st.sectionLabel}>Plan size</Text>
                    {plans.map((p) => {
                      const on = draft.plan_id === p.id
                      return (
                        <Pressable key={p.id} style={[st.choice, on && st.choiceOn]} onPress={() => setDraft((d) => ({ ...d, plan_id: p.id }))}>
                          <View style={{ flex: 1 }}>
                            <Text style={st.choiceTitle}>{p.name}</Text>
                            <Text style={st.choiceSub}>{p.meals_total} meals · {rupees(p.base_price)}</Text>
                          </View>
                          {on && <Check size={18} color={Colors.primary} />}
                        </Pressable>
                      )
                    })}

                    <Text style={[st.sectionLabel, { marginTop: 18 }]}>Meals per day</Text>
                    {(['meals_lunch', 'meals_dinner'] as const).map((slot) => (
                      <View key={slot} style={st.stepperRow}>
                        <Text style={st.stepperLabel}>{slot === 'meals_lunch' ? 'Lunch' : 'Dinner'}</Text>
                        <View style={st.stepper}>
                          <Pressable style={st.stepBtn} onPress={() => setCount(slot, -1)} hitSlop={6}>
                            <Minus size={16} color={Colors.text} />
                          </Pressable>
                          <Text style={st.stepValue}>{draft[slot]}</Text>
                          <Pressable style={st.stepBtn} onPress={() => setCount(slot, 1)} hitSlop={6}>
                            <Plus size={16} color={Colors.text} />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    {draft.meals_lunch + draft.meals_dinner < 1 && (
                      <Text style={st.errorText}>Choose at least one lunch or dinner.</Text>
                    )}

                    {addons.length > 0 && <Text style={[st.sectionLabel, { marginTop: 18 }]}>Add-ons (every meal)</Text>}
                    {addons.map((a) => {
                      const on = draft.addon_ids.includes(a.id)
                      return (
                        <Pressable key={a.id} style={[st.choice, on && st.choiceOn]} onPress={() => toggleAddon(a.id)}>
                          <View style={{ flex: 1 }}>
                            <Text style={st.choiceTitle}>{a.name}</Text>
                            <Text style={st.choiceSub}>+{rupees(a.price_per_meal)} per meal</Text>
                          </View>
                          <View style={[st.checkbox, on && st.checkboxOn]}>{on && <Check size={14} color="#fff" />}</View>
                        </Pressable>
                      )
                    })}

                    <Text style={st.cardNote}>Delivery days, menu and address stay the same — change them anytime in Plan Settings.</Text>
                    {draftPrice !== null && couponsAllowed(draft.plan_id) && (
                      <View style={{ marginTop: 12 }}>
                        <CouponField planId={draft.plan_id} addonIds={draft.addon_ids} applied={coupon} onChange={setCoupon} />
                      </View>
                    )}
                    <Pressable
                      style={[st.primaryBtn, !draftValid && st.btnDisabled]}
                      disabled={!draftValid}
                      onPress={() => onRenew(draft, coupon && couponsAllowed(draft.plan_id) ? coupon.code : undefined)}
                    >
                      <Text style={st.primaryBtnText}>
                        {draftPrice !== null ? `Pay ${rupees(coupon && couponsAllowed(draft.plan_id) ? coupon.total : draftPrice)}` : 'Choose a plan'}
                      </Text>
                    </Pressable>
                  </>
                )}

                {step === 'cancel' && (
                  <>
                    <Text style={st.lead}>
                      Your meals stop and the plan closes.
                      {walletBalance !== null && walletBalance > 0
                        ? ` The ${rupees(walletBalance)} in your wallet stays yours — use it for future orders, or contact us about a refund.`
                        : ''}
                    </Text>
                    <Pressable
                      style={[st.dangerBtn, cancelling && st.btnDisabled]}
                      disabled={cancelling}
                      onPress={async () => {
                        setCancelling(true)
                        try { await onCancelPlan() } finally { setCancelling(false) }
                      }}
                    >
                      {cancelling ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryBtnText}>Yes, cancel my plan</Text>}
                    </Pressable>
                    <Pressable style={st.ghostBtn} onPress={() => setStep('menu')}>
                      <Text style={st.ghostBtnText}>Keep my plan</Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '88%' },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  headerBack: { width: 28, alignItems: 'center' },
  headerTitle: { fontFamily: Fonts.headingSemi, fontSize: 17, color: Colors.text },

  lead: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 21, marginBottom: 16 },

  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10,
    borderRadius: 16, borderWidth: 1, borderColor: Colors.borderFaint, backgroundColor: '#fff',
  },
  optionIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.text },
  optionSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2, lineHeight: 17 },

  card: { backgroundColor: Colors.primaryLight, borderRadius: 16, padding: 16, marginBottom: 12 },
  cardTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.text, marginBottom: 6 },
  cardLine: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text, marginBottom: 2 },
  cardNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 10, lineHeight: 17 },
  walletNote: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 4 },

  sectionLabel: {
    fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textLight,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
  },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 8,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.borderFaint,
  },
  choiceOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  choiceTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  choiceSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  stepperLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: Colors.borderFaint, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, minWidth: 16, textAlign: 'center' },
  errorText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 4 },

  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  dangerBtn: { backgroundColor: Colors.danger, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  ghostBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10, borderWidth: 1.5, borderColor: Colors.primary },
  ghostBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },
  btnDisabled: { opacity: 0.4 },

  statusWrap: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  statusTitle: { fontFamily: Fonts.headingSemi, fontSize: 20, color: Colors.text, textAlign: 'center' },
  statusText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
})
