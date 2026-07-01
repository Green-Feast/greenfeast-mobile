export const Colors = {
  // ── Brand green scale ───────────────────────────────────────────
  green900: '#16301A',
  green800: '#1E4024',
  green700: '#1B5E20',   // PRIMARY
  green600: '#3D6E48',
  green500: '#538B5F',
  green200: '#A8C8B2',
  green100: '#D4E8DA',
  green50:  '#EEF6F1',

  // ── Logo yellow ─────────────────────────────────────────────────
  yellow400: '#E8CB42',

  // ── Cream neutrals (page canvas) ────────────────────────────────
  cream50:  '#FDFAF3',   // page background
  cream100: '#FAF7EE',   // subtle surface
  cream200: '#F5F1E4',   // cards / panels
  cream300: '#EDE8D6',
  cream400: '#E0D9C4',   // borders / dividers

  // ── Ink (warm dark text) ─────────────────────────────────────────
  ink900: '#3A3228',     // primary text
  ink600: '#6B5E50',
  ink500: '#8A7B6D',     // secondary / subtitles
  ink400: '#A8998C',     // placeholder
  ink300: '#C4B8AE',     // disabled
  ink100: '#DDD5CC',     // hairline separator

  // ── Macro palette (NO green here) ───────────────────────────────
  macroProtein:     '#B54A35',
  macroProteinTint: '#F5E8E5',
  macroCarbs:       '#C48A20',
  macroCarbsTint:   '#FBF3E0',
  macroFat:         '#4F7BA6',
  macroFatTint:     '#E5EFF7',
  macroFibre:       '#8A5C9A',
  macroFibreTint:   '#F2EBF6',

  // ── Allergen badge ───────────────────────────────────────────────
  badgeBg:   '#FBF3E0',
  badgeText: '#8A6010',

  // ── Semantic feedback ────────────────────────────────────────────
  danger:      '#C04A35',
  dangerLight: '#F8E5E1',
  success:     '#1B5E20',
  whatsapp:    '#25D366',

  // ── Legacy aliases (keep until all screens are reworked) ────────
  primary:          '#1B5E20',   // = green700
  primaryDark:      '#1E4024',   // = green800
  primaryLightGreen:'#3D6E48',   // = green600
  primaryLight:     '#EEF6F1',   // = green50
  primaryMid:       '#A8C8B2',   // = green200
  forest:           '#16301A',   // = green900
  accent:           '#E8CB42',   // = yellow400
  accentLight:      '#FBF3E0',   // honey tint
  accentText:       '#8A6010',   // = badgeText
  background:       '#FDFAF3',   // = cream50
  surface:          '#FAF7EE',   // = cream100
  text:             '#3A3228',   // = ink900
  textMuted:        '#8A7B6D',   // = ink500
  textLight:        '#A8998C',   // = ink400
  border:           '#E0D9C4',   // = cream400
  borderFaint:      '#DDD5CC',   // = ink100
  hover:            '#F5F1E4',   // = cream200
}

export const Fonts = {
  // Fraunces — editorial serif (replaces Poppins)
  heading:     'Fraunces_300Light',
  headingSemi: 'Fraunces_400Regular',
  headingMed:  'Fraunces_300Light',

  // Inter — body (unchanged)
  body:     'Inter_400Regular',
  bodyMed:  'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',

  // Caveat — script accent
  script:    'Caveat_400Regular',
  scriptMed: 'Caveat_500Medium',
}
