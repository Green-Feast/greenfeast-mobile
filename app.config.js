// Dynamic config wrapper around app.json.
//
// The static config lives in app.json; this file injects the Google Maps API
// keys from the environment so they never get committed to source control.
//
// Locally these come from .env (Expo loads it automatically). For EAS builds
// they must be provided as EAS environment variables:
//   eas env:create --name GOOGLE_MAPS_API_KEY_ANDROID --value <key> --visibility plaintext --environment preview --environment production
//   eas env:create --name GOOGLE_MAPS_API_KEY_IOS --value <key> --visibility plaintext --environment preview --environment production
//
// iOS goes through react-native-maps' own config plugin (below) instead of
// expo.ios.config.googleMapsApiKey: since react-native-maps 1.23.0 restructured
// its podspec to a `react-native-maps/Google` subspec, Expo's older generic
// mechanism still writes a Podfile line for a standalone `react-native-google-maps`
// pod that no longer exists, which fails `pod install`. The bundled plugin writes
// the correct pod line itself, so ios.config.googleMapsApiKey must stay unset —
// setting both would run two competing Podfile mods.
const appJson = require('./app.json')

module.exports = () => {
  const expo = appJson.expo

  return {
    ...expo,
    android: {
      ...expo.android,
      config: {
        ...(expo.android.config || {}),
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY_ANDROID,
        },
      },
    },
    plugins: [
      ...expo.plugins,
      ['react-native-maps', { iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY_IOS }],
    ],
  }
}
