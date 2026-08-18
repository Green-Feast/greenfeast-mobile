// Shared by the Menu tab, Home's category row, and MealDetailModal. Lives
// here (not exported from menu.tsx) specifically so MealDetailModal can use
// it without menu.tsx <-> component circular imports.
export const CATEGORIES = ['All', 'Bowl', 'Wrap', 'Salad', 'Toast', 'Smoothie']

export const CATEGORY_EMOJIS: Record<string, string> = {
  bowl: '🥗', wrap: '🌯', salad: '🥙', toast: '🍞', smoothie: '🥤',
}

// Dedicated category icons (square, transparent WebP) for Home's category
// row — replaces the old fallback of borrowing a representative meal's
// photo. Uploaded via scripts/upload-category-images.ts; CATEGORY_EMOJIS
// above stays as the fallback for any category that doesn't have one.
const CATEGORY_IMAGES_BASE = 'https://amwwjcwoumhbdxaxvexj.supabase.co/storage/v1/object/public/category-images'
export const CATEGORY_IMAGES: Record<string, string> = {
  bowl: `${CATEGORY_IMAGES_BASE}/bowl_category.webp`,
  wrap: `${CATEGORY_IMAGES_BASE}/wrap_category.webp`,
  salad: `${CATEGORY_IMAGES_BASE}/salad_category.webp`,
  toast: `${CATEGORY_IMAGES_BASE}/toast_category.webp`,
  smoothie: `${CATEGORY_IMAGES_BASE}/smoothie_category.webp`,
}
