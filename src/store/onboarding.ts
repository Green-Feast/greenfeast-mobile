import { create } from 'zustand'

export type PlanId = 'trial' | 'plan15' | 'plan30'
export type DeliveryMode = 'opt-in' | 'opt-out'
export type HealthGoal = 'build-muscle' | 'lose-weight' | 'improve-wellness' | 'boost-energy'
export type MenuType = 'M1' | 'M2'

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
  healthGoal: HealthGoal | null
  exerciseType: string[]
  exerciseFrequency: string
  occupation: string

  // S5 — questionnaire
  q1Answer: string
  q2Answer: string
  derivedMenu: MenuType | null
  derivedAddons: string[]   // addon IDs recommended by questionnaire logic

  // S8/S8b — plan selection
  planId: PlanId | null
  planName: string          // e.g. "Power & Recover" from recommendation, or "Custom Plan" from fallback
  addOns: AddOnSelection[]

  // S6 — dietary preferences
  allergens: string[]
  dietaryPreference: 'none' | 'vegetarian' | 'vegan'
  proteinPreference: string[]
  baseAvoidance: string[]
  veggieAvoidance: string[]
  spicePreference: 'mild' | 'medium' | 'spicy' | ''
  dressingPreference: 'mixed-in' | 'on-the-side' | ''
  dietaryFreeText: string

  // S9 — delivery days
  selectedDays: string[]
  deliveryMode: DeliveryMode

  // S10 — address + meal slots
  addressLine1: string
  addressLandmark: string
  addressPincode: string
  addressLabel: string
  addressType: 'home' | 'office' | 'other'
  mealsLunch: number
  mealsDinner: number

  // Actions
  setHealthProfile: (fields: {
    height: string
    weight: string
    healthGoal: HealthGoal
    exerciseType: string[]
    exerciseFrequency: string
    occupation: string
  }) => void
  setQuestionnaire: (fields: {
    q1Answer: string
    q2Answer?: string
    derivedMenu: MenuType
    derivedAddons: string[]
  }) => void
  setPlan: (planId: PlanId, planName: string, addOns: AddOnSelection[]) => void
  setDietary: (fields: {
    allergens: string[]
    dietaryPreference: 'none' | 'vegetarian' | 'vegan'
    proteinPreference: string[]
    baseAvoidance: string[]
    veggieAvoidance: string[]
    spicePreference: 'mild' | 'medium' | 'spicy' | ''
    dressingPreference: 'mixed-in' | 'on-the-side' | ''
    dietaryFreeText: string
  }) => void
  setDays: (selectedDays: string[], deliveryMode: DeliveryMode) => void
  setAddress: (fields: {
    addressLine1: string
    addressLandmark: string
    addressPincode: string
    addressLabel: string
    addressType: 'home' | 'office' | 'other'
    mealsLunch: number
    mealsDinner: number
  }) => void
  reset: () => void
}

const defaultState: Omit<OnboardingState, keyof Pick<OnboardingState,
  'setHealthProfile' | 'setQuestionnaire' | 'setPlan' | 'setDietary' |
  'setDays' | 'setAddress' | 'reset'
>> = {
  height: '',
  weight: '',
  healthGoal: null,
  exerciseType: [],
  exerciseFrequency: '',
  occupation: '',
  q1Answer: '',
  q2Answer: '',
  derivedMenu: null,
  derivedAddons: [],
  planId: null,
  planName: '',
  addOns: [],
  allergens: [],
  dietaryPreference: 'none',
  proteinPreference: [],
  baseAvoidance: [],
  veggieAvoidance: [],
  spicePreference: '',
  dressingPreference: '',
  dietaryFreeText: '',
  selectedDays: [],
  deliveryMode: 'opt-out',
  addressLine1: '',
  addressLandmark: '',
  addressPincode: '',
  addressLabel: 'Home',
  addressType: 'home',
  mealsLunch: 1,
  mealsDinner: 0,
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...defaultState,

  setHealthProfile: (fields) => set(fields),

  setQuestionnaire: ({ q1Answer, q2Answer = '', derivedMenu, derivedAddons }) =>
    set({ q1Answer, q2Answer, derivedMenu, derivedAddons }),

  setPlan: (planId, planName, addOns) => set({ planId, planName, addOns }),

  setDietary: (fields) => set(fields),

  setDays: (selectedDays, deliveryMode) => set({ selectedDays, deliveryMode }),

  setAddress: (fields) => set(fields),

  reset: () => set(defaultState as OnboardingState),
}))
