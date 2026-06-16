// GreenFeast palette — mirrors the demo app's design tokens exactly.
export const Colors = {
  // Greens
  primary: '#1B5E20',        // gf-green
  primaryDark: '#0D3F12',    // gf-green-dark (pressed/active)
  primaryLightGreen: '#388E3C', // gf-green-light
  primaryLight: '#E8F5E9',   // gf-green-pale (pale fills)
  primaryMid: '#A5D6A7',     // light green text on dark bg
  forest: '#1A2E1A',         // very dark green feature card

  // Accent
  accent: '#FCD303',         // gf-yellow
  accentLight: '#FFF59D',    // gf-yellow-light
  accentText: '#B45309',     // amber/brown (for accent labels)

  // Neutrals
  background: '#FDF9E8',     // gf-cream
  surface: '#FFFFFF',
  text: '#1A1A1A',           // gf-charcoal
  textMuted: '#6B7280',      // gf-gray
  textLight: '#9CA3AF',      // lighter gray
  border: '#E5E7EB',         // gf-gray-light
  borderFaint: '#F3F4F6',
  hover: '#F9FAFB',

  // Status
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  success: '#16A34A',
  whatsapp: '#25D366',
}

// Font family names registered in the root layout via expo-font.
export const Fonts = {
  // Poppins — headings / emphasis
  heading: 'Poppins_700Bold',
  headingSemi: 'Poppins_600SemiBold',
  headingMed: 'Poppins_500Medium',
  // Inter — body
  body: 'Inter_400Regular',
  bodyMed: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
}
