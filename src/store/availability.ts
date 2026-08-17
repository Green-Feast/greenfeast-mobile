// Per-date meal/add-on availability + Today's Special, set by the admin
// Kitchen tab (038_daily_availability.sql). Each surface needs a different
// date (Menu = today, a day-modal = the selected day, AddToDaySheet = each
// chip's day), so this holds a whole date window rather than a single date.
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { istToday, addDaysISO } from '@/lib/ist'

const WINDOW_DAYS = 7

type AvailabilityState = {
  anchorDate: string | null
  // Only the unavailable ids are tracked per date — absence from the set
  // means available, mirroring the DB's "row absent or is_available=true"
  // rule exactly, and it's the only thing any read path actually needs.
  unavailableMeals: Map<string, Set<string>>
  unavailableAddons: Map<string, Set<string>>
  specials: Map<string, string[]>
  loaded: boolean
  loadWindow: (from: string, to: string) => Promise<void>
  ensureFresh: () => Promise<void>
}

export const useAvailabilityStore = create<AvailabilityState>((set, get) => ({
  anchorDate: null,
  unavailableMeals: new Map(),
  unavailableAddons: new Map(),
  specials: new Map(),
  loaded: false,

  loadWindow: async (from, to) => {
    try {
      const [mealRes, addonRes, specialRes] = await Promise.all([
        supabase
          .from('meal_availability')
          .select('for_date, meal_template_id')
          .gte('for_date', from)
          .lte('for_date', to)
          .eq('is_available', false),
        supabase
          .from('addon_availability')
          .select('for_date, addon_id')
          .gte('for_date', from)
          .lte('for_date', to)
          .eq('is_available', false),
        supabase
          .from('daily_specials')
          .select('for_date, sort_order, meal_template_id')
          .gte('for_date', from)
          .lte('for_date', to)
          .order('sort_order'),
      ])

      const unavailableMeals = new Map<string, Set<string>>()
      for (const r of (mealRes.data ?? []) as { for_date: string; meal_template_id: string }[]) {
        const s = unavailableMeals.get(r.for_date) ?? new Set<string>()
        s.add(r.meal_template_id)
        unavailableMeals.set(r.for_date, s)
      }

      const unavailableAddons = new Map<string, Set<string>>()
      for (const r of (addonRes.data ?? []) as { for_date: string; addon_id: string }[]) {
        const s = unavailableAddons.get(r.for_date) ?? new Set<string>()
        s.add(r.addon_id)
        unavailableAddons.set(r.for_date, s)
      }

      const specials = new Map<string, string[]>()
      for (const r of (specialRes.data ?? []) as { for_date: string; sort_order: number; meal_template_id: string }[]) {
        const arr = specials.get(r.for_date) ?? []
        arr[r.sort_order - 1] = r.meal_template_id
        specials.set(r.for_date, arr)
      }
      for (const [date, arr] of specials) {
        specials.set(date, arr.filter(Boolean))
      }

      set({ anchorDate: istToday(), unavailableMeals, unavailableAddons, specials, loaded: true })
    } catch (e) {
      // Fail open — leave whatever was already loaded (or empty, on a first-
      // load failure) so everything reads as available rather than the menu
      // silently vanishing on a network blip. This also decouples the OTA
      // from the migration: if this ships before the tables exist, the app
      // just degrades to pre-availability behaviour instead of breaking.
      console.warn('[availability] load failed:', e)
      set({ loaded: true })
    }
  },

  // Refetch when the calendar day has rolled over — an app left open across
  // IST midnight would otherwise show yesterday's availability forever.
  ensureFresh: async () => {
    const { anchorDate, loadWindow } = get()
    const today = istToday()
    if (anchorDate === today) return
    await loadWindow(today, addDaysISO(today, WINDOW_DAYS))
  },
}))

// Pure selectors, exported separately so a component reading one item
// doesn't re-render on every store update via changing Map identity.
export function isMealAvailable(
  state: Pick<AvailabilityState, 'unavailableMeals'>,
  date: string,
  mealId: string
): boolean {
  return !state.unavailableMeals.get(date)?.has(mealId)
}

export function isAddonAvailable(
  state: Pick<AvailabilityState, 'unavailableAddons'>,
  date: string,
  addonId: string
): boolean {
  return !state.unavailableAddons.get(date)?.has(addonId)
}

export function specialsFor(state: Pick<AvailabilityState, 'specials'>, date: string): string[] {
  return state.specials.get(date) ?? []
}
