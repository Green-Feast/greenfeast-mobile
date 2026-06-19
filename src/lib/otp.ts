import Constants, { ExecutionEnvironment } from 'expo-constants'

// The MSG91 OTP widget relies on a native module (BiometricAuth) that isn't
// bundled in Expo Go — importing the package there crashes on load. So we only
// `require` it in real builds and fall back to a safe shim in Expo Go.
// While testing in Expo Go, use the Dev-Skip buttons to bypass OTP.
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

type OTPWidgetType = {
  initializeWidget: (widgetId: string, tokenAuth: string) => void
  sendOTP: (args: { identifier: string }) => Promise<any>
  verifyOTP: (args: { reqId: string; otp: string }) => Promise<any>
  retryOTP: (args: { reqId: string }) => Promise<any>
}

const OTP_UNAVAILABLE = 'OTP is unavailable in Expo Go — use Dev: Skip, or test in a dev/preview build.'

const shim: OTPWidgetType = {
  initializeWidget: () => {},
  sendOTP: async () => { throw new Error(OTP_UNAVAILABLE) },
  verifyOTP: async () => { throw new Error(OTP_UNAVAILABLE) },
  retryOTP: async () => {},
}

export const OTPWidget: OTPWidgetType = isExpoGo
  ? shim
  : require('@msg91comm/sendotp-react-native').OTPWidget
