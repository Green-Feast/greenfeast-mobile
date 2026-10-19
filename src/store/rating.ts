import { create } from 'zustand'
import type { MealRating, RatingPrompt, RatingSource, Slot } from '@/lib/ratings'

// The rating sheet is one app-wide sheet (RatingSheetHost in the (app)
// layout), opened from Home's card, Order history or a "How was your lunch?"
// push. `meal` is missing when a push opened it — the host loads it.
// `version` goes up after every saved rating so screens can refresh.
export type RatingSheetRequest = {
  date: string
  slot: Slot
  source: RatingSource
  meal?: RatingPrompt | null
  initialStars?: number
  existing?: MealRating | null
}

interface RatingState {
  sheet: RatingSheetRequest | null
  version: number
  open: (req: RatingSheetRequest) => void
  close: () => void
  saved: () => void
}

export const useRatingStore = create<RatingState>((set) => ({
  sheet: null,
  version: 0,
  open: (req) => set({ sheet: req }),
  close: () => set({ sheet: null }),
  saved: () => set((s) => ({ version: s.version + 1 })),
}))
