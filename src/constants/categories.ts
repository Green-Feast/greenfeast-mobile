// Shared by the Menu tab, Home's category row, and MealDetailModal. Lives
// here (not exported from menu.tsx) specifically so MealDetailModal can use
// it without menu.tsx <-> component circular imports.
export const CATEGORIES = ['All', 'Bowl', 'Wrap', 'Salad', 'Toast', 'Smoothie']

export const CATEGORY_EMOJIS: Record<string, string> = {
  bowl: '🥗', wrap: '🌯', salad: '🥙', toast: '🍞', smoothie: '🥤',
}
