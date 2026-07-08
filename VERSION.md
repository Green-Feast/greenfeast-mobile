# GreenFeast Version History

This file is the source of truth for the app's version, shown on the Account
screen (`src/constants/version.ts` mirrors it and is what the app actually
renders — the two must always match).

## Format: `1.x.y`

- **1** — major version. Bumped manually, only for major releases. Almost
  never changes.
- **x** — native build number. Incremented **only** when a new native binary
  is created with `eas build`.
- **y** — OTA update number. Incremented **only** when a JS-only change is
  published with `eas update`. **Resets to 0** every time `x` increments.

```
1.3.7  →  eas build  →  1.4.0  →  eas update  →  1.4.1  →  eas update  →  1.4.2
```

## Release workflow — read before bumping anything

**Versions are bumped only on the user's explicit approval — never
automatically as a side effect of a commit, a PR, or "the code looks
release-ready."** If commits have landed on `main` but this file hasn't been
updated to match, treat the running app as still under development at the
last version recorded below — do not assume a release happened, and do not
silently bump the number to "catch up."

When the user does approve a release, do both of these together, in the same
commit:

### On a new EAS Build (`eas build ...`)
1. In `src/constants/version.ts`: increment `build` by 1, reset `ota` to `0`.
2. In this file: add a new `## 1.x.0` section below (see format under
   "Changelog") with today's date and a short changelog of what's in the
   build.

### On a new OTA Update (`eas update ...`)
1. In `src/constants/version.ts`: increment `ota` by 1. Leave `build`
   unchanged.
2. In this file: add a new `## 1.x.y` section below with today's date and a
   short changelog of what the update contains.

### Major version bump
Manual, rare, and only when the user explicitly says so — e.g. a significant
relaunch. Reset `build` and `ota` to `0` when this happens.

---

## Changelog

Each entry: version, release date, build/OTA numbers, and a short bullet list
of what changed. Newest first.

### 1.3.2 — 2026-07-08
- Build 3, OTA 2.
- Republish of 1.3.1 — same app code, fixed update bundle. **Root cause of the
  entire "OTA updates never apply" saga found and fixed:** updates published
  with `--environment preview` take env vars from the EAS server environment
  (not local `.env` / `eas.json`), which was missing all `EXPO_PUBLIC_*` vars —
  so every published bundle crashed on launch (`supabaseUrl is required`) and
  was permanently blacklisted by expo-updates' anti-bricking recovery, leaving
  the embedded build running forever. All six vars now live in the EAS preview
  environment. Details in AGENTS.md "Known gotchas."
- The 1.3.1 update group is abandoned (broken bundle, blacklisted on devices
  that attempted it).

### 1.3.1 — 2026-07-08
- Build 3, OTA 1.
- Home: fixed "No delivery today" showing incorrectly on days with both a
  lunch and dinner order; fixed hero-to-section spacing.
- My Plan: fixed "View details" button text overflow; removed duplicate
  Skip/Pause tiles and Wallet/Address/Settings cards (consolidated into the
  hero card, Add Money modal, and Plan Settings); extra dishes are now
  removable before the cutoff; hero Skip button now skips only the viewed
  slot (lunch or dinner) instead of the whole day; week strip now
  auto-scrolls to today; fixed date-strip-to-hero-card spacing; fixed a
  dashed-border-sticking bug when switching between empty and populated days.
- Backend: new `remove-dish` edge function; `manage-subscription`'s skip
  handler now accepts an optional `meal_slot` (backward-compatible — Plan
  Settings' whole-day skip flow is unaffected).

### 1.3.0 — 2026-07-07
- Build 3, OTA 0.
- "Update downloaded" notification is now actionable: tapping it calls
  `Updates.reloadAsync()` to apply the pending update immediately instead of
  waiting for a cold-start relaunch.
- Added before/after `console.log` around every reload (updateId/channel/
  runtimeVersion/isEmbeddedLaunch) so `adb logcat` shows definitively whether
  a reload actually switched updates.
- Added a "Check update logs" diagnostic (dev-only) that calls
  `Updates.readLogEntriesAsync()` and displays expo-updates' own internal
  log entries (including error codes like `UpdateFailedToLoad`,
  `AssetsFailedToLoad`) directly in the Account screen.
- New build (not just OTA) so this ships regardless of the still-open OTA
  delivery investigation — see AGENTS.md known gotchas once resolved.

### 1.2.2 — 2026-07-06
- Build 2, OTA 2.
- Added a bell icon on Home with a local notification history (AsyncStorage),
  fed by real expo-updates lifecycle events: "Update downloaded — reopen to
  install" and "Update installed" (both OTA and native builds).
- Added placeholder Terms & Conditions / Privacy Policy documents, reachable
  from anywhere (required an AuthGate exemption for the new `legal` route
  group). Required consent checkbox added to the universal new-account gate
  (name.tsx); permanent view-only links added to the Account page.
- **Requires migration 026_terms_consent.sql to be run before this ships** —
  it adds `users.terms_accepted_at` / `users.terms_version`, which the
  signup flow now writes to.

### 1.2.1 — 2026-07-06
- Build 2, OTA 1.
- Implemented the true Guest App states from APP_FLOW.md (G1/G2/G4), which
  were never built — Home, Subscribe, and Account only ever handled the
  logged-in-no-subscription case, so an anonymous guest saw a broken blank
  profile instead of a Login/Sign Up prompt, and "Build your plan" pushed
  guests straight into the health wizard with no session.
- Home/Subscribe/Account now all wait for the auth store to finish resolving
  before deciding what to render, fixing a startup race that could briefly
  misrender the wrong state on cold launch.

### 1.2.0 — 2026-07-06
- Build 2, OTA 0.
- New native build. Embeds all fixes from 1.1.0–1.1.2 directly (nav bar
  insets, version display, tab bar press animation + crash fix) so they land
  regardless of OTA state.
- Added a dev-only updates diagnostic on the Account screen (channel / embedded
  vs OTA / updateId / runtime), gated behind SHOW_DEV_SKIP, to make OTA state
  visible on-device. Needed because OTA updates were not reaching an older
  install and the on-device channel/update state couldn't be inspected
  otherwise.

### 1.1.2 — 2026-07-02
- Build 1, OTA 2.
- Fixed a crash introduced in 1.1.1: expo-router's tab bar invokes
  `tabBarButton` as a plain function call rather than via JSX, so a component
  using Reanimated hooks directly couldn't be passed as that option — its
  hooks attached to the wrong fiber and crashed on mount. Fixed by wrapping it
  in JSX (`(props) => <TabBarButton {...props} />`) at the call site instead.

### 1.1.1 — 2026-07-02
- Build 1, OTA 1.
- Replaced the default Android ripple on the bottom tab bar with a custom
  scale/opacity press animation (Reanimated) and a light haptic tick.

### 1.1.0 — 2026-07-02
- Build 1, OTA 0.
- Fixed `eas.json` build profiles missing a `"channel"` key — every build made
  before this one had no update channel embedded, so no `eas update` could
  ever reach an installed app. New builds now correctly wire
  development/preview/production channels.
- Also carries everything already published to the `preview` OTA branch
  (Android 3-button nav bar inset fixes, in-app version display).

### 1.0.1 — 2026-07-02
- Build 0, OTA 1.
- Version control implemented.

### 1.0.0 — 2026-07-02
- Build 0, OTA 0.
- Versioning system introduced. This is the starting point for build/OTA
  tracking — earlier EAS builds made before this system existed are not
  retroactively numbered.
