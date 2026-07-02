# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Project

GreenFeast is a Jaipur-based meal subscription startup. This repo (`greenfeast-mobile`,
local path `greenfeast-app`) is the subscriber-facing Expo React Native app. Sole developer
is Rudransh Nareda (final-year MBBS student, no formal CS background, learning full-stack
by building this — prefers first-principles technical explanations over analogies).

**This is the final production app for App Store / Play Store submission — not a demo, MVP,
or prototype.** Every change should be production-grade: no shortcuts, no "good enough for a
demo" reasoning, proper error handling at system boundaries, full UX polish.

Sibling repos: `greenfeast-admin` (Next.js admin dashboard), Supabase backend (auth, postgres,
edge functions). Payments via Razorpay.

# Git / GitHub

- Repo lives in the **Green-Feast** GitHub org (private): `github.com/Green-Feast/greenfeast-mobile`, branch `main`.
- **Push as the `greenfeast` account via `gh`, never as `rudranshnareda`** — that account has no access to the Green-Feast org and pushes will fail with "Repository not found". `gh auth status` should show `greenfeast` as active; if not, that's a red flag, stop and ask.
- Commit author identity is set via local git config: `greenfeast <greenfeast.tech@gmail.com>`.
- **Never add a `Co-Authored-By: Claude` trailer to commits.** The user wants commits attributed solely to the project identity.

# EAS builds and updates

- `eas.json` has three profiles: `development` (dev client, for `expo start`), `preview`
  (internal-distribution APK, side-loadable — this is the one used for day-to-day device
  testing), `production` (`.aab` for Play Store).
- Standard test build command: `npx eas build --platform android --profile preview --non-interactive`.
  Builds are queued and can take **hours**, not minutes — kick off in the background.
- `gh`/`eas` are already authenticated as the `greenfeast` account on this machine.
- **`eas build` is fine to run directly** — it only produces an installable artifact.
- **Never run `eas update` (OTA push) directly.** Commit the change and hand the user the
  exact `eas update` command to run themselves — they want to control the timing since OTA
  pushes go live to real users immediately. Native-only changes (new native deps, app.json
  native config like `adaptiveIcon`/`softwareKeyboardLayoutMode`) can't ship via OTA at all
  and require a full rebuild.

# Known gotchas

- `tsconfig.json`'s `@/assets/*` path alias maps to the **project-root** `assets/` folder,
  not `src/assets/` — the more general `@/*` → `./src/*` alias does NOT cover it. Any asset
  `require()`d via `@/assets/...` must physically live in root `assets/`, or Metro fails to
  resolve it at bundle time (this broke an EAS build once — JS bundling phase failure).
- Android adaptive icon: `android.adaptiveIcon.backgroundColor` (in `app.json`) is what's
  actually used, not a background image. The `foregroundImage` layer needs safe-zone padding
  — keep visible content to roughly the center 66% of the canvas — or it gets clipped by
  circular/squircle launcher masks.
- Keyboard handling uses `react-native-keyboard-controller` via a custom
  `KeyboardAwareScreen`/`useAutoFocus` wrapper in `src/components/keyboard/`, used across all
  onboarding text-input screens. Native dependency — needs a rebuild (not OTA-able) when it
  or its config changes.

# UI/UX design system

The app went through a full UI/UX rework (completed 2026-07-02) to a new design system:
Fraunces (headings) + Caveat (script accents) replacing Poppins, warm cream canvas, deep
forest-green primary (`#1B5E20`), a dedicated macro nutrition color palette, and shared
components (`OnboardingProgress`, `MacroRow`, `AllergenBadge`, `RulerPicker`). Haptic feedback
(`expo-haptics`) is wired throughout: Light on selections, Medium on primary actions, Success
notification on payment confirmation / welcome moments. All onboarding + app-tab screens have
been migrated. Legacy `Colors.*` aliases in `src/constants/colors.ts` still resolve to the
same hex values as the new named tokens, so old and new naming can coexist safely.
