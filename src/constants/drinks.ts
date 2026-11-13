// Drinks (migration 088). A drink is a meal_templates row whose category is
// 'smoothie' or 'coffee' - there is no separate catalogue. A plan "has a
// drink" when it has a subscription add-on with addons.is_drink = true (today
// the 'smoothie' add-on), priced exactly like any other add-on; the app just
// groups it as "Drink" instead of listing it among the add-ons.
//
// Deliverable (a customer may pick it for a delivery) = is_active AND
// subscription_valid. Coffee is dine-in only today, so it only reaches the
// Walk-in sheet; the kitchen picks the day's drink and the customer may swap
// it in Customize (update-day-cart set_drink).
export const DRINK_CATEGORIES = ['smoothie', 'coffee'] as const

export function isDrinkCategory(category: string | null | undefined): boolean {
  return !!category && (DRINK_CATEGORIES as readonly string[]).includes(category)
}

// How the drink add-on is presented wherever add-ons are chosen.
export const DRINK_NAME = 'Drink'
export const DRINK_TAGLINE = 'Smoothie with every meal'
export const DRINK_HINT = 'The kitchen picks a fresh one daily. You can swap it for any day in My Plan.'

// A drink order with no drink dish picked (orders.drink_template_id is null).
export const CHEFS_CHOICE_DRINK = "Chef's choice smoothie"

// The add-on's name as shown to the customer: the drink add-on is just "Drink".
export function addonLabel(a: { name: string; is_drink?: boolean | null }): string {
  return a.is_drink ? DRINK_NAME : a.name
}
