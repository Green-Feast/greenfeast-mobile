# Keyboard UX Refactor — `keyboard-ux-refactor` branch

> QA-only branch. Goal: make the keyboard experience across **auth + onboarding**
> feel as polished as Linear / Stripe / Apple apps. No redesign — colors,
> spacing, typography, animations, navigation, and business logic are unchanged.
> The only thing improved is keyboard behaviour.

---

## 1. Root cause of the bugs (why the old approach failed)

Every auth/onboarding screen used React Native's built-in `KeyboardAvoidingView`
(`behavior="padding"` on iOS, `"height"` on Android), plus per-screen
`InteractionManager` + `setTimeout` focus hacks.

**Expo SDK 56 / RN 0.85 runs edge-to-edge by default.** Under edge-to-edge,
Android's `adjustResize` (set in `app.json` via `softwareKeyboardLayoutMode: "resize"`)
silently degrades to `adjustNothing` — **the window never actually resizes when
the keyboard opens.** So:

- `KeyboardAvoidingView`'s height/padding math is computed against a window that
  doesn't move → residual padding/height that never resets on dismissal. That is
  the **leftover grey rectangle** at the bottom of the screen.
- The same mis-measurement left the **CTA stuck behind the keyboard** until a
  second focus — which is exactly why the codebase had grown deferred-focus
  workarounds (`InteractionManager.runAfterInteractions` + `setTimeout(…, 50)`)
  on the name/phone screens. Those were band-aids over the real problem.

This is a known issue: Reanimated 4 deprecated `useAnimatedKeyboard` and the
Reanimated team now points users to `react-native-keyboard-controller` for
keyboard handling. (Refs: [Expo keyboard handling guide](https://docs.expo.dev/guides/keyboard-handling/),
[react-native-keyboard-controller docs](https://kirillzyusko.github.io/react-native-keyboard-controller/docs/installation),
[Reanimated `useAnimatedKeyboard` deprecation](https://docs.swmansion.com/react-native-reanimated/docs/device/useAnimatedKeyboard/).)

---

## 2. Chosen solution

**`react-native-keyboard-controller` (v1.21.6, installed via `expo install`).**

Why this library:

- It reads the **real IME frame natively** and exposes it as Reanimated
  animated values, so layout is driven frame-synced with the OS keyboard
  animation — no JS measurement race, no double-compensation, no flicker.
- It is **correct under edge-to-edge** on both iOS and Android, which RN's
  `KeyboardAvoidingView` is not.
- It is the path the Reanimated team officially recommends now that
  `useAnimatedKeyboard` is deprecated, and it builds on Reanimated 4 +
  Worklets, both already in this project.
- No Expo config plugin required — it is autolinked; it only needs a dev/EAS
  rebuild (native code). No `babel.config.js` change: Expo's default
  `babel-preset-expo` already enables the Worklets transform.

No hardcoded keyboard heights, no platform hacks — only the library's proper
APIs.

---

## 3. Architecture — reusable keyboard system

All new code lives in **`src/components/keyboard/`** and is shared by the whole
flow, so no screen reinvents keyboard handling.

| File | Responsibility |
|---|---|
| `useAutoFocus.ts` | Hook returning a `TextInput` ref. Focuses the first logical input **after the screen's enter transition settles** (via `useFocusEffect` + `InteractionManager`), so the keyboard opens cleanly instead of fighting the slide-in. Replaces every per-screen `autoFocus` / `setTimeout` hack. |
| `KeyboardStickyFooter.tsx` | A primary CTA pinned above the keyboard. `KeyboardStickyView` lifts it with the native animation curve so it is **never covered**. It owns the safe-area bottom inset and animates it: full inset when closed (no leftover space), collapsed when open (snug above the keyboard, no oversized gap). |
| `KeyboardAwareScreen.tsx` | The screen container. Body = `KeyboardAwareScrollView` (focused input always scrolled above the keyboard; the extra space is removed cleanly on dismiss). Optional `footer` is rendered through `KeyboardStickyFooter`. Auto-measures footer height and feeds it into `bottomOffset` so focused inputs clear the sticky CTA too. |
| `index.ts` | Barrel export. |

**One root change:** `src/app/_layout.tsx` wraps the app in `<KeyboardProvider>`
(inside `GestureHandlerRootView`). Required by the library; everything else is
opt-in per screen.

### Two layout archetypes, one system

- **Pinned-CTA screens** (`name`, `phone`, `otp`): header/form at the top, CTA
  pinned at the bottom via the sticky footer. The old `<View style={{flex:1}}/>`
  spacer is gone — the footer is now genuinely keyboard-aware.
- **Long-form / inline-CTA screens** (`address`, login `phone`): the CTA stays
  inline at the end of the scroll (native long-form pattern). The
  keyboard-aware scroll keeps the focused field — and the button right after it —
  visible above the keyboard.

The bespoke **`Wizard`** keeps its per-step fade/slide animation and its
non-scrolling drag-to-rank step, but now uses `KeyboardAwareScrollView` for
scrollable steps and the shared `KeyboardStickyFooter` for its Continue button,
so it behaves identically to the rest of the flow.

---

## 4. Files changed

**New (reusable infrastructure):**
- `src/components/keyboard/KeyboardAwareScreen.tsx`
- `src/components/keyboard/KeyboardStickyFooter.tsx`
- `src/components/keyboard/useAutoFocus.ts`
- `src/components/keyboard/index.ts`

**Root wiring:**
- `src/app/_layout.tsx` — `KeyboardProvider` added.

**Screens migrated off RN `KeyboardAvoidingView`:**
- `src/app/(auth)/phone.tsx` — login; swapped RN `KeyboardAvoidingView` for the
  library's drop-in (preserves the hero + bottom-sheet card layout exactly).
- `src/app/(auth)/otp.tsx` — `KeyboardAwareScreen` + autofocus on the OTP field.
- `src/app/(onboarding)/name.tsx` — `KeyboardAwareScreen` + sticky footer + autofocus.
- `src/app/(onboarding)/phone.tsx` — `KeyboardAwareScreen` + sticky footer + autofocus.
- `src/app/(onboarding)/address.tsx` — `KeyboardAwareScreen` (inline CTA) + autofocus on the first field.

**Shared component:**
- `src/components/Wizard.tsx` — uses `KeyboardAwareScrollView` + `KeyboardStickyFooter`
  (drives `health`, `dietary`, `questionnaire`).

**Dependency:**
- `package.json` / `package-lock.json` — `react-native-keyboard-controller@1.21.6`.

Screens with no text input (`gate`, `loading`, `menu`, `plan`, `days`,
`summary`, `payment`, `recommendation`, `addon-upsell`, `questionnaire` choices)
were intentionally **not** touched.

---

## 5. How each requirement is met

- **Autofocus** — `useAutoFocus` focuses the first field after the transition
  settles (name, phone, otp, address first field). *Login is deliberately left
  without autofocus — it is social-login-first, and popping the keyboard would
  bury the Google/Apple buttons. Wizard steps are not autofocused because most
  steps are choice/drag based; auto-opening the keyboard there would be
  intrusive and would alter the step animation feel.* Flag for QA if you want
  these changed.
- **CTA always visible** — `KeyboardStickyFooter` (`KeyboardStickyView`) keeps
  the primary CTA above the keyboard on pinned-CTA screens; on long forms the
  keyboard-aware scroll keeps the focused field + following CTA visible.
- **No overlap / no leftover space / no jump / no flicker** — native frame-synced
  insets; layout restores exactly on dismiss.
- **Grey rectangle** — root cause (edge-to-edge + RN `KeyboardAvoidingView`)
  removed, not masked.
- **Smooth animation** — CTA and content ride the OS keyboard curve together.

---

## 6. QA checklist (must be verified on real builds)

> ⚠️ This was implemented and type-checked on a Windows dev box. It could **not**
> be run on an iOS/Android build here. `react-native-keyboard-controller` ships
> native code, so it requires a fresh dev build (`expo run:android` /
> `expo run:ios`) or an EAS build — a JS-only reload will not pick it up.

Verify on device/emulator, both platforms:

- [ ] Keyboard opens automatically on `name`, `phone` (onboarding), `otp`, and
      `address` (first field), after the slide-in finishes.
- [ ] Primary CTA stays visible above the keyboard on name / phone / otp and in
      the Wizard (health, dietary).
- [ ] Login screen: focusing email/password lifts the card; Google/Apple still
      reachable; no keyboard auto-pop.
- [ ] Address: focusing each field (incl. landmark/label near the bottom) keeps
      it and the "Review order" button visible.
- [ ] Dismiss the keyboard on every screen → **no leftover grey area**, layout
      returns to original.
- [ ] Switch between fields (login email↔password, address fields) → smooth, no
      flicker.
- [ ] Tall and short phones; notched (safe-area) and non-notched devices.
- [ ] Gesture-navigation Android devices (3-button and gesture nav).
- [ ] Password field (`secureTextEntry`) on login behaves correctly.

---

## 7. Status

- Branch: `keyboard-ux-refactor` (created off `main`; **not merged**).
- `main` is untouched. Cherry-pick / merge only after on-device QA passes.
- Typecheck: clean for all keyboard changes (the single pre-existing
  `_layout.tsx` `segments[1]` tuple error is unrelated navigation code and was
  left as-is per scope).
