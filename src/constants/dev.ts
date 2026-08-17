// Controls the "Dev: Skip ..." shortcut buttons in onboarding/payment and the
// "Dev: Reset all data" button on Account.
//
// - In a local dev build (`expo run:android` / Metro), `__DEV__` is true.
// - In a preview APK we set EXPO_PUBLIC_DEV_SKIP=1 (see eas.json "preview" env)
//   so testers can bypass OAuth/OTP/payment without real MSG91/Cashfree keys.
// - The production profile leaves EXPO_PUBLIC_DEV_SKIP unset, so the buttons
//   never appear for real users.
export const SHOW_DEV_SKIP = __DEV__ || process.env.EXPO_PUBLIC_DEV_SKIP === '1'

// Login's own "Dev: Skip Login" button is intentionally NOT gated by
// SHOW_DEV_SKIP — that flag is true in every preview build, which used to
// mean a hardcoded test@test.com / test1234 credential shipped in the JS
// bundle of every preview APK, regardless of whether the button rendered.
// Restricted to __DEV__ only (Metro/dev client), and the credential itself
// now comes from env vars so it isn't in the bundle at all when unset.
export const SHOW_DEV_LOGIN = __DEV__
export const DEV_LOGIN_EMAIL = process.env.EXPO_PUBLIC_DEV_EMAIL ?? ''
export const DEV_LOGIN_PASSWORD = process.env.EXPO_PUBLIC_DEV_PASSWORD ?? ''
