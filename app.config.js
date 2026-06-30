// Dynamic config wrapper around app.json.
//
// The static config lives in app.json; this file injects the Google Maps API
// keys from the environment so they never get committed to source control.
//
// Locally these come from .env (Expo loads it automatically). For EAS builds
// they must be provided as EAS environment variables:
//   eas env:create --name GOOGLE_MAPS_API_KEY_ANDROID --value <key> --visibility plaintext --environment preview --environment production
//   eas env:create --name GOOGLE_MAPS_API_KEY_IOS --value <key> --visibility plaintext --environment preview --environment production
const appJson = require('./app.json')

module.exports = () => {
  const expo = appJson.expo

  return {
    ...expo,
    ios: {
      ...expo.ios,
      config: {
        ...(expo.ios.config || {}),
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY_IOS,
      },
    },
    android: {
      ...expo.android,
      config: {
        ...(expo.android.config || {}),
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY_ANDROID,
        },
      },
    },
  }
}
