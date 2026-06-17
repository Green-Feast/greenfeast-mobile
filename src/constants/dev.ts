// Controls the "Dev: Skip ..." shortcut buttons in auth/onboarding/payment.
//
// - In a local dev build (`expo run:android` / Metro), `__DEV__` is true.
// - In a preview APK we set EXPO_PUBLIC_DEV_SKIP=1 (see eas.json "preview" env)
//   so testers can bypass OAuth/OTP/payment without real MSG91/Razorpay keys.
// - The production profile leaves EXPO_PUBLIC_DEV_SKIP unset, so the buttons
//   never appear for real users.
export const SHOW_DEV_SKIP = __DEV__ || process.env.EXPO_PUBLIC_DEV_SKIP === '1'
