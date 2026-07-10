/**
 * Single source of truth for the app's displayed version, shown on the
 * Account screen as `MAJOR.BUILD.OTA` (e.g. 1.4.2).
 *
 * This is a custom scheme, independent of app.json's `expo.version` or the
 * native Android versionCode / iOS buildNumber:
 *
 *   MAJOR — bumped manually, only for major releases (rare)
 *   BUILD — incremented only when a new `eas build` is created; OTA resets to 0
 *   OTA   — incremented only when a new `eas update` is published
 *
 * The full release history and the exact bump workflow live in VERSION.md at
 * the project root — read that before changing anything here. Versions are
 * bumped only on explicit approval, never automatically alongside unrelated
 * code changes.
 */
export const APP_VERSION = {
  major: 1,
  build: 3,
  ota: 6,
} as const

export const APP_VERSION_STRING = `${APP_VERSION.major}.${APP_VERSION.build}.${APP_VERSION.ota}`
