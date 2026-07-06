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
