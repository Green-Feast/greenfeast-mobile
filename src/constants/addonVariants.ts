// Add-ons that come in variants. The variant is free text on the server
// (subscription_addons.sub_option / order_addons.sub_option); these are the
// ones the kitchen makes. Used by Walk-in (087). The smoothie is no longer
// here: drinks are real menu dishes the kitchen picks daily (088).
export const ADDON_VARIANTS: Record<string, string[]> = {
  cheese: ['Feta', 'Parmesan', 'Cheddar'],
}
