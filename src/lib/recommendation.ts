// ─────────────────────────────────────────────────────────────────────────────
// GreenFeast — Plan Recommendation Engine (Stack Logic v3)
//
// Single source of truth for the perception layer: goal + questionnaire answers
// + exercise frequency → plan name, menu, recommended add-ons, derived
// constraints, and recommended meal count. The backend stays simple (meal count
// + constraints + add-ons); all the named-plan identity lives here.
//
// See: stack-logic.txt §05 (stack table), §08 (meal counts), sub-flow.txt S4-S9.
// ─────────────────────────────────────────────────────────────────────────────

export type HealthGoal = 'build-muscle' | 'lose-weight' | 'improve-wellness' | 'boost-energy'
// One weekly menu for everyone since migration 052 (the M2 track is gone).
export type MenuType = 'M1'
// Plans live in the plans table; plan60 (067) is never a recommendation — the
// recommendation screen offers it as an upgrade.
export type PlanId = 'trial' | 'plan15' | 'plan30' | 'plan60'

export type Recommendation = {
  planName: string
  tagline: string
  menuType: MenuType
  derivedAddons: string[]        // addon IDs — must exist in the `addons` table
  derivedConstraints: string[]   // e.g. ['less-carbs', 'more-fibre']
  recommendedMealCount: 15 | 30  // 5-meal trial is never a primary recommendation
  recommendedPlanId: 'plan15' | 'plan30'
}

// ── Display labels (perception layer) ────────────────────────────────────────

export const MENU_LABELS: Record<MenuType, string> = {
  M1: 'Global Menu',
}

export const CONSTRAINT_LABELS: Record<string, string> = {
  'less-carbs': 'Less carbs',
  'more-fibre': 'More fibre',
}

// ── Plan names ("Daily" set) ─────────────────────────────────────────────────

function planNameFor(goal: HealthGoal, q1: string): string {
  switch (goal) {
    case 'build-muscle':
      return q1 === 'cut' ? 'Define Daily' : 'Build Daily'
    case 'lose-weight':
      return 'Lean Daily'
    case 'improve-wellness':
      return q1 === 'gut' ? 'Restore Daily' : 'Clean Daily'
    case 'boost-energy':
      return q1 === 'crash' ? 'Focus Daily' : 'Fuel Daily'
  }
}

function taglineFor(goal: HealthGoal, q1: string): string {
  switch (goal) {
    case 'build-muscle':
      return q1 === 'cut'
        ? 'Lean, high-protein meals to cut without losing muscle.'
        : 'Calorie-dense, protein-rich meals to fuel growth.'
    case 'lose-weight':
      return 'Light, balanced meals to help you lose weight steadily.'
    case 'improve-wellness':
      return q1 === 'gut'
        ? 'Gut-friendly, anti-inflammatory meals to help you feel light.'
        : 'Wholesome global meals to help you eat clean.'
    case 'boost-energy':
      return q1 === 'crash'
        ? 'Steady-energy meals to beat the afternoon crash.'
        : 'Nutrient-dense meals to power through fatigue.'
  }
}

// ── Stack table: menu + add-ons + constraints (stack-logic.txt §05) ───────────

// The answers still pick add-ons and constraints; the menu is the same for everyone.
type StackRow = { derivedAddons: string[]; derivedConstraints: string[] }

function stackFor(goal: HealthGoal, q1: string, q2: string): StackRow {
  if (goal === 'build-muscle') {
    if (q1 === 'cut') return { derivedAddons: ['extra-protein'], derivedConstraints: ['less-carbs'] }
    return { derivedAddons: ['smoothie', 'extra-protein'], derivedConstraints: [] } // bulk
  }

  if (goal === 'lose-weight') {
    if (q1 === 'bloating') {
      return q2 === 'exercise'
        ? { derivedAddons: ['seeds', 'extra-protein'], derivedConstraints: ['less-carbs'] }
        : { derivedAddons: ['seeds'], derivedConstraints: ['less-carbs', 'more-fibre'] }
    }
    if (q1 === 'lean-out') {
      return q2 === 'exercise'
        ? { derivedAddons: ['extra-protein'], derivedConstraints: ['less-carbs'] }
        : { derivedAddons: [], derivedConstraints: ['less-carbs'] }
    }
    // condition
    return q2 === 'exercise'
      ? { derivedAddons: ['extra-protein', 'seeds'], derivedConstraints: ['less-carbs'] }
      : { derivedAddons: ['seeds'], derivedConstraints: ['less-carbs'] }
  }

  if (goal === 'improve-wellness') {
    if (q1 === 'gut') return { derivedAddons: ['seeds'], derivedConstraints: ['more-fibre'] }
    return { derivedAddons: [], derivedConstraints: [] } // clean
  }

  // boost-energy
  if (q1 === 'crash') return { derivedAddons: ['seeds'], derivedConstraints: [] }
  return { derivedAddons: ['exotic-fruits'], derivedConstraints: [] } // stamina
}

// ── Meal count (layered model, stack-logic.txt §08) ───────────────────────────
// Logic 3 (highest priority): health condition → always 30.
// Logic 2: Daily / 4-5×/wk → 30; Rarely → 15; 2-3×/wk → fall through to Logic 1.
// Logic 1: goal default — muscle/weight → 30, wellness/energy → 15.
// Never returns 5: the 5-meal trial is only ever the secondary trial card.

function mealCountFor(goal: HealthGoal, q1: string, exerciseFrequency: string): 15 | 30 {
  if (goal === 'lose-weight' && q1 === 'condition') return 30 // Logic 3

  if (exerciseFrequency === 'Daily' || exerciseFrequency === '4-5 times a week') return 30 // Logic 2
  if (exerciseFrequency === 'Rarely') return 15 // Logic 2

  // '2-3 times a week' or unspecified → Logic 1 (goal default)
  return goal === 'build-muscle' || goal === 'lose-weight' ? 30 : 15
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeRecommendation(input: {
  goal: HealthGoal
  q1: string
  q2?: string
  exerciseFrequency: string
}): Recommendation {
  const { goal, q1, q2 = '', exerciseFrequency } = input
  const stack = stackFor(goal, q1, q2)
  const mealCount = mealCountFor(goal, q1, exerciseFrequency)
  return {
    planName: planNameFor(goal, q1),
    tagline: taglineFor(goal, q1),
    menuType: 'M1',
    derivedAddons: stack.derivedAddons,
    derivedConstraints: stack.derivedConstraints,
    recommendedMealCount: mealCount,
    recommendedPlanId: mealCount === 30 ? 'plan30' : 'plan15',
  }
}
