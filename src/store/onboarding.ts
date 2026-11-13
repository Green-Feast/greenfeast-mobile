import { create } from 'zustand'
import type { HealthGoal, MenuType, PlanId, Recommendation } from '@/lib/recommendation'
import { supabase } from '@/lib/supabase'

// Re-export the domain types so existing screen imports keep working.
export type { HealthGoal, MenuType, PlanId, Recommendation }
export type DeliveryMode = 'opt-in' | 'opt-out'

export interface AddOnSelection {
  id: string
  name: string
  pricePerMeal: number  // in paise
  subOption?: string    // smoothie flavour, cheese type, etc.
}

interface OnboardingState {
  // S4 — health profile
  height: string
  weight: string
  proteinTarget: string         // optional daily protein target (g)
  fibreTarget: string           // optional daily fibre target (g)
  healthGoal: HealthGoal | null // = goalRanking[0]; drives questionnaire + engine
  goalRanking: HealthGoal[]     // full priority order (drag-to-rank)
  exerciseType: string[]
  exerciseFrequency: string
  occupation: string

  // S6 — questionnaire + engine output
  q1Answer: string
  q2Answer: string
  recommendation: Recommendation | null

  // S9/S10 — plan selection
  planId: PlanId | null
  planName: string
  addOns: AddOnSelection[]
  upsellShown: boolean          // add-on upsell (S11) shows at most once

  // S7 — dietary basics (collected PRE-payment, drive recommendation badges)
  allergens: string[]
  dietaryPreference: 'none' | 'vegetarian' | 'vegan'
  dietaryFreeText: string

  // S12 — delivery days + meal timing
  selectedDays: string[]
  deliveryMode: DeliveryMode
  mealsLunch: number
  mealsDinner: number

  // S13 — address
  addressLine1: string
  addressLandmark: string
  addressCity: string           // from the map pin / autocomplete / pincode lookup — never hardcoded
  addressPincode: string
  addressLabel: string
  addressType: 'home' | 'office' | 'other'
  addressLat: number | null
  addressLng: number | null

  // Actions
  setHealthProfile: (fields: {
    height: string
    weight: string
    proteinTarget: string
    fibreTarget: string
    healthGoal: HealthGoal
    goalRanking: HealthGoal[]
    exerciseType: string[]
    exerciseFrequency: string
    occupation: string
  }) => void
  setQuestionnaire: (fields: {
    q1Answer: string
    q2Answer?: string
    recommendation: Recommendation
  }) => void
  setPlan: (planId: PlanId, planName: string, addOns: AddOnSelection[]) => void
  setUpsellShown: () => void
  setDietaryBasics: (fields: {
    allergens: string[]
    dietaryPreference: 'none' | 'vegetarian' | 'vegan'
    dietaryFreeText: string
  }) => void
  setDays: (selectedDays: string[], deliveryMode: DeliveryMode, mealsLunch: number, mealsDinner: number) => void
  setAddress: (fields: {
    addressLine1: string
    addressLandmark: string
    addressCity: string
    addressPincode: string
    addressLabel: string
    addressType: 'home' | 'office' | 'other'
    addressLat: number | null
    addressLng: number | null
  }) => void
  reset: () => void
}

type ActionKeys =
  | 'setHealthProfile' | 'setQuestionnaire' | 'setPlan' | 'setUpsellShown'
  | 'setDietaryBasics' | 'setDays' | 'setAddress' | 'reset'

const defaultState: Omit<OnboardingState, ActionKeys> = {
  height: '',
  weight: '',
  proteinTarget: '',
  fibreTarget: '',
  healthGoal: null,
  goalRanking: [],
  exerciseType: [],
  exerciseFrequency: '',
  occupation: '',
  q1Answer: '',
  q2Answer: '',
  recommendation: null,
  planId: null,
  planName: '',
  addOns: [],
  upsellShown: false,
  allergens: [],
  dietaryPreference: 'none',
  dietaryFreeText: '',
  selectedDays: [],
  deliveryMode: 'opt-out',
  mealsLunch: 1,
  mealsDinner: 0,
  addressLine1: '',
  addressLandmark: '',
  addressCity: '',
  addressPincode: '',
  addressLabel: 'Home',
  addressType: 'home',
  addressLat: null,
  addressLng: null,
}

// Plan, add-ons, days and the lunch/dinner split live only here until payment.
// Mirror them to users.onboarding_draft (migration 090) as they change, so if
// the user stops before paying, admin → Users can see them and pick up from
// there. Best effort: a failed save never blocks onboarding.
function saveDraft(s: OnboardingState) {
  ;(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('users').update({
      onboarding_draft: {
        planId: s.planId,
        planName: s.planName,
        addonIds: s.addOns.map((a) => a.id),
        days: s.selectedDays,
        mealsLunch: s.mealsLunch,
        mealsDinner: s.mealsDinner,
        updatedAt: new Date().toISOString(),
      },
    }).eq('id', user.id)
  })().catch(() => {})
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  ...defaultState,

  setHealthProfile: (fields) => set(fields),

  setQuestionnaire: ({ q1Answer, q2Answer = '', recommendation }) =>
    set({ q1Answer, q2Answer, recommendation }),

  setPlan: (planId, planName, addOns) => {
    set({ planId, planName, addOns })
    saveDraft(get())
  },

  setUpsellShown: () => set({ upsellShown: true }),

  setDietaryBasics: (fields) => set(fields),

  setDays: (selectedDays, deliveryMode, mealsLunch, mealsDinner) => {
    set({ selectedDays, deliveryMode, mealsLunch, mealsDinner })
    saveDraft(get())
  },

  setAddress: (fields) => set(fields),

  reset: () => set(defaultState as OnboardingState),
}))
