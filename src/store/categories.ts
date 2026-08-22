// Admin-editable categories (migration 041 — previously a hardcoded array +
// a Postgres CHECK constraint). Seeded with today's actual values so a
// failed fetch — or an app still on an old OTA before this store existed —
// degrades to exactly the old hardcoded behaviour, never an empty menu.
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { CATEGORIES, CATEGORY_EMOJIS, CATEGORY_IMAGES } from '@/constants/categories'

export type CategoryRow = {
  id: string
  name: string
  sortOrder: number
  emoji: string | null
  imageUrl: string | null
}

// Built from the pre-041 hardcoded constants, so the seed is exactly what
// every device already showed before this store (or the categories table)
// existed — one definition, not a second copy that can drift from it.
const SEED_CATEGORIES: CategoryRow[] = CATEGORIES
  .filter((name) => name !== 'All')
  .map((name, i) => {
    const id = name.toLowerCase()
    return { id, name, sortOrder: i + 1, emoji: CATEGORY_EMOJIS[id] ?? null, imageUrl: CATEGORY_IMAGES[id] ?? null }
  })

type CategoriesState = {
  categories: CategoryRow[]
  loaded: boolean
  load: () => Promise<void>
}

export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  categories: SEED_CATEGORIES,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, sort_order, emoji, image_url')
        .eq('is_active', true)
        .order('sort_order')
      if (error) throw error
      if (data && data.length > 0) {
        set({
          categories: data.map((c) => ({
            id: c.id, name: c.name, sortOrder: c.sort_order, emoji: c.emoji, imageUrl: c.image_url,
          })),
          loaded: true,
        })
      } else {
        set({ loaded: true })
      }
    } catch (e) {
      // Fail open — keep the seeded defaults rather than an empty filter bar.
      console.warn('[categories] load failed:', e)
      set({ loaded: true })
    }
  },
}))

export function categoryEmoji(categories: CategoryRow[], id: string): string {
  return categories.find((c) => c.id === id)?.emoji ?? '🍽️'
}
