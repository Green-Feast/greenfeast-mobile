import LegalDocScreen from '@/components/LegalDocScreen'
import { PRIVACY_TEXT } from '@/constants/legal'

export default function PrivacyScreen() {
  return <LegalDocScreen title="Privacy Policy" body={PRIVACY_TEXT} />
}
