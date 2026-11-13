// Drinks (migration 088). A drink is a meal_templates row whose category is one
// of these — there is no separate catalogue. Mirrors the category list in
// is_deliverable_drink() / check_drink_template() in SQL.
export const DRINK_CATEGORIES = ['smoothie', 'coffee'] as const

export function isDrinkCategory(category: string | null | undefined): boolean {
  return !!category && (DRINK_CATEGORIES as readonly string[]).includes(category)
}

// A drink comes with the meal (the plan's drink add-on); it is never the meal
// itself. Same wording as set_my_meal_rule() in SQL.
export const DRINK_AS_MEAL_ERROR = "A drink can't be your meal — pick a dish. Your drink comes with it."
