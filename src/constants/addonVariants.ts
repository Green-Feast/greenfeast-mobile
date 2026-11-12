// Add-ons that come in flavours. The flavour is free text on the server
// (subscription_addons.sub_option / order_addons.sub_option); these are the
// ones the kitchen makes. Used by Walk-in (087).
export const ADDON_VARIANTS: Record<string, string[]> = {
  smoothie: ['Berry Banana Protein', 'Watermelon Mint Chia', 'Creamy Avocado'],
  cheese: ['Feta', 'Parmesan', 'Cheddar'],
}
